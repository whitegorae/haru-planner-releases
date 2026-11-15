'use strict';

/* =========================================================================
 * 클라우드 동기화 (Supabase)
 *
 * 테이블
 *  - events       : 할 일·일정. title / start_at / end_at 은 일반 컬럼,
 *                   앱의 나머지 정보(완료·목록·색·메모·하위 작업·반복 등)는 details(jsonb).
 *                   client_id = 앱의 할 일 id.
 *  - planner_meta : 목록·디데이·타이머 기록·설정·진행 중인 타이머 (kind + id 로 한 줄씩)
 *
 * 동작
 *  - 바뀐 줄만 골라서 올리고(upsert/delete), 다른 PC의 변경은 Realtime으로 바로 받아요.
 *  - 같은 항목을 두 PC에서 고치면 나중에 고친 쪽(_v 버전이 큰 쪽)이 남아요.
 *  - 끊겼다 다시 연결되면 전체를 한 번 맞춰요(resync).
 *  - 화면 크기·사이드바 접힘처럼 PC마다 다른 설정은 동기화하지 않아요.
 *  - 다른 앱이 events 에 title/start_at/end_at 만 넣어도 할 일로 보여요.
 * ========================================================================= */

const Cloud = (() => {
  const CFG_KEY = 'haru-cloud-config';
  const DEVICE_KEY = 'haru-device-settings';
  const EVENTS = 'events';
  const META = 'planner_meta';
  const DEVICE_SETTINGS = ['zoom', 'sidebarCollapsed', 'closeToTray', 'openAtLogin', 'gcalSync', 'gcalCalendarId', 'gcalListId']; // 구글 연결은 PC 마다 따로
  const META_KINDS = { list: 'lists', dday: 'ddays', session: 'sessions' };

  let client = null;
  let user = null;
  let unsub = null;
  let active = false;
  let wasDown = false;
  let getData = () => null;
  let onRemote = () => {};
  const synced = new Map(); // "kind:id" → 서버에 있다고 알고 있는 내용 (키 정렬한 JSON)
  const ver = new Map(); // "kind:id" → 버전(ms)
  const sidOf = new Map(); // "task:<할 일 id>" → events.id (서버 번호)
  const keyOfSid = new Map(); // events.id → "task:<할 일 id>"
  const noCid = new Set(); // client_id 없이 다른 곳에서 만든 events 줄
  let pushTimer = null;
  let retryTimer = null;
  let pushing = null;
  let again = false;
  let status = 'off';
  let statusMsg = '';
  const listeners = new Set();

  const setStatus = (s, msg = '') => { status = s; statusMsg = msg; listeners.forEach((f) => f(s, msg)); };
  const strip = (d) => { const o = { ...(d || {}) }; delete o._v; return o; };
  // jsonb는 키 순서를 바꿔 저장해서, 비교할 땐 키를 정렬해서 문자열로 만들어요
  const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, k) => { o[k] = x[k]; return o; }, {}) : x));

  // ---------- 설정 ----------
  function config() {
    const env = window.api && window.api.cloudConfig; // .env 의 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(CFG_KEY)); } catch (_) { stored = null; }
    if (env && env.url && env.key) return { url: env.url, key: env.key, enabled: !(stored && stored.enabled === false), fromEnv: true };
    return stored && stored.url && stored.key ? stored : null;
  }
  const saveConfig = (c) => localStorage.setItem(CFG_KEY, JSON.stringify(c));

  function deviceSettings() {
    try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveDevice(settings) {
    const o = {};
    DEVICE_SETTINGS.forEach((k) => { if (k in settings) o[k] = settings[k]; });
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(o)); } catch (_) { /* 무시 */ }
  }

  // ---------- 할 일 ↔ events 줄 ----------
  const p2 = (n) => String(n).padStart(2, '0');
  const ymdOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const nextDay = (s) => { const [y, m, d] = s.split('-').map(Number); return ymdOf(new Date(y, m - 1, d + 1)); };
  const prevDay = (s) => { const [y, m, d] = s.split('-').map(Number); return ymdOf(new Date(y, m - 1, d - 1)); };
  const localISO = (dateStr, time) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = (time || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm).toISOString();
  };
  const sameTime = (a, b) => (a == null && b == null) || (a != null && b != null && new Date(a).getTime() === new Date(b).getTime());

  // 시간 있는 할 일: start_at = end_at = 그 시각
  // 종일 할 일: start_at = 첫날 0시, end_at = 마지막 날 다음 날 0시 (끝은 포함 안 함, 캘린더 표준)
  // 시작~끝 시각이 있는 할 일: start_at = 시작, end_at = 끝 시각
  function taskTimes(t) {
    if (!t.dueDate) return { start_at: null, end_at: null };
    const start = localISO(t.dueDate, t.dueTime);
    const last = t.endDate && t.endDate > t.dueDate ? t.endDate : t.dueDate;
    let end;
    if (t.dueTime && t.endTime) end = localISO(last, t.endTime);
    else end = t.dueTime && last === t.dueDate ? start : localISO(nextDay(last), null);
    return { start_at: start, end_at: end };
  }
  function datesFromTimes(s, e) {
    if (!s) return { dueDate: null, dueTime: null, endDate: null, endTime: null };
    const S = new Date(s);
    const dueDate = ymdOf(S);
    const dueTime = S.getHours() === 0 && S.getMinutes() === 0 ? null : `${p2(S.getHours())}:${p2(S.getMinutes())}`;
    let endDate = null;
    let endTime = null;
    if (e) {
      const E = new Date(e);
      let last = ymdOf(E);
      if (dueTime && E > S) endTime = `${p2(E.getHours())}:${p2(E.getMinutes())}`;
      else if (!dueTime && E > S && E.getHours() === 0 && E.getMinutes() === 0) last = prevDay(last);
      endDate = last > dueDate ? last : null;
    }
    return { dueDate, dueTime, endDate, endTime };
  }
  function eventToTask(row) {
    const det = row.details && typeof row.details === 'object' ? strip(row.details) : {};
    const base = typeof makeTask === 'function' ? makeTask() : {};
    const t = { ...base, ...det };
    t.id = row.client_id || det.id || `ev-${row.id}`;
    if (typeof row.title === 'string') t.title = row.title;
    if (!det.createdAt && row.created_at) t.createdAt = new Date(row.created_at).getTime();
    // 다른 앱에서 시간을 바꿨으면(또는 details 가 없으면) 컬럼 값을 따라가요
    const cur = taskTimes(t);
    if (!sameTime(cur.start_at, row.start_at) || !sameTime(cur.end_at, row.end_at)) Object.assign(t, datesFromTimes(row.start_at, row.end_at));
    return t;
  }
  function eventRow(row) {
    const t = eventToTask(row);
    return { kind: 'task', id: t.id, data: { ...t, _v: Number(row.details && row.details._v) || 0 }, sid: row.id, hasCid: !!row.client_id };
  }
  function remember(r) {
    if (r.kind !== 'task' || r.sid == null) return;
    const k = `task:${r.id}`;
    sidOf.set(k, r.sid);
    keyOfSid.set(String(r.sid), k);
    if (r.hasCid) noCid.delete(k); else noCid.add(k);
  }
  function forget(k) {
    const sid = sidOf.get(k);
    if (sid != null) keyOfSid.delete(String(sid));
    sidOf.delete(k);
    noCid.delete(k);
  }

  // ---------- 앱 데이터 ↔ 항목 ----------
  function syncedSettings(settings) {
    const st = { ...settings };
    DEVICE_SETTINGS.forEach((k) => delete st[k]);
    return st;
  }
  function entities(data) {
    const m = new Map();
    for (const t of data.tasks || []) m.set(`task:${t.id}`, { kind: 'task', id: t.id, obj: t });
    for (const [kind, prop] of Object.entries(META_KINDS)) for (const o of data[prop] || []) m.set(`${kind}:${o.id}`, { kind, id: o.id, obj: o });
    m.set('meta:settings', { kind: 'meta', id: 'settings', obj: syncedSettings(data.settings) });
    m.set('meta:timer', { kind: 'meta', id: 'timer', obj: { value: data.activeTimer || null } });
    return m;
  }
  function localStr(data, k) {
    const i = k.indexOf(':');
    const kind = k.slice(0, i);
    const id = k.slice(i + 1);
    if (kind === 'meta') {
      if (id === 'settings') return stable(syncedSettings(data.settings));
      if (id === 'timer') return stable({ value: data.activeTimer || null });
      return undefined;
    }
    const arr = kind === 'task' ? data.tasks : data[META_KINDS[kind]];
    const o = arr && arr.find((x) => x.id === id);
    return o ? stable(o) : undefined;
  }
  function applyRowTo(data, kind, id, obj) {
    if (kind === 'meta') {
      if (id === 'settings') {
        const keep = {};
        DEVICE_SETTINGS.forEach((k) => { if (k in data.settings) keep[k] = data.settings[k]; });
        data.settings = { ...data.settings, ...obj, ...keep };
      } else if (id === 'timer') data.activeTimer = obj.value || null;
      return;
    }
    const prop = kind === 'task' ? 'tasks' : META_KINDS[kind];
    if (!prop) return;
    const arr = data[prop];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  }
  function removeFrom(data, kind, id) {
    const prop = kind === 'task' ? 'tasks' : META_KINDS[kind];
    if (prop) data[prop] = data[prop].filter((x) => x.id !== id);
  }
  function buildData(rows, base) {
    const data = { version: 3, lists: [], tasks: [], ddays: [], sessions: [], activeTimer: null, settings: { ...base.settings } };
    for (const r of rows) applyRowTo(data, r.kind, r.id, strip(r.data));
    Object.assign(data.settings, deviceSettings());
    return data;
  }

  // ---------- 연결 / 로그인 ----------
  // 메일 링크를 누르면 브라우저가 이 주소로 앱을 열어요 (Supabase → Auth → URL Configuration 에 등록 필요)
  // 모바일(웹 앱)은 메일 링크가 웹 앱 주소로 돌아오게 window.api.authRedirect 로 바꿔요
  const REDIRECT = (window.api && window.api.authRedirect) || 'haruplanner://auth-callback';
  const AUTH_KEY = 'haru-auth';
  const REMEMBER_KEY = 'haru-remember';
  const RECOVERY_FLAG = 'haru-recovery-pending';

  // 자동 로그인: 켜면 로그인 상태를 저장하고, 끄면 메모리에만 둬서 앱을 닫으면 로그아웃돼요.
  // (메일 링크 확인에 필요한 code-verifier 는 앱을 다시 켜도 쓰도록 항상 저장해요)
  const mem = new Map();
  const remembering = () => { try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (_) { return true; } };
  const authStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : localStorage.getItem(k)),
    setItem: (k, v) => {
      if (remembering() || k.includes('code-verifier')) { localStorage.setItem(k, v); mem.delete(k); }
      else { mem.set(k, v); localStorage.removeItem(k); }
    },
    removeItem: (k) => { mem.delete(k); localStorage.removeItem(k); },
  };
  function setRemember(on) {
    try { localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch (_) { /* 무시 */ }
    const cur = authStorage.getItem(AUTH_KEY);
    if (cur == null) return;
    if (on) { localStorage.setItem(AUTH_KEY, cur); mem.delete(AUTH_KEY); }
    else { mem.set(AUTH_KEY, cur); localStorage.removeItem(AUTH_KEY); }
  }

  function connect(url, key) {
    if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase 라이브러리를 불러오지 못했어요');
    client = window.supabase.createClient(url.trim(), key.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY, storage: authStorage, flowType: 'pkce', detectSessionInUrl: false },
    });
    return client;
  }
  async function currentUser() {
    const { data } = await client.auth.getSession();
    user = data && data.session ? data.session.user : null;
    return user;
  }
  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    try { localStorage.removeItem(RECOVERY_FLAG); } catch (_) { /* 무시 */ }
    user = data.user;
    return user;
  }
  async function signOut() {
    stop();
    try { await client.auth.signOut(); } catch (_) { /* 무시 */ }
    user = null;
  }

  // 회원가입: 인증 메일을 보내요. (Supabase에서 이메일 인증을 껐다면 바로 로그인돼요)
  async function signUp(email, password) {
    try { localStorage.removeItem(RECOVERY_FLAG); } catch (_) { /* 무시 */ }
    const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: REDIRECT } });
    if (error) throw error;
    // 이미 가입된 이메일이면 Supabase가 오류 대신 빈 identities 를 돌려줘요
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      const e = new Error('User already registered');
      e.code = 'user_already_exists';
      throw e;
    }
    if (data.session) user = data.user;
    return { needsConfirm: !data.session, user: data.user };
  }
  async function resendSignup(email) {
    const { error } = await client.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: REDIRECT } });
    if (error) throw error;
  }
  // 메일에 있는 6자리 코드로 확인 (링크가 안 열릴 때)
  async function verifyCode(email, token, kind) {
    const types = kind === 'recovery' ? ['recovery'] : ['email', 'signup'];
    let lastErr = null;
    for (const type of types) {
      const { data, error } = await client.auth.verifyOtp({ email: email.trim(), token: token.trim(), type });
      if (!error) { user = data.user; return user; }
      lastErr = error;
    }
    throw lastErr;
  }
  async function sendReset(email) {
    try { localStorage.setItem(RECOVERY_FLAG, '1'); } catch (_) { /* 무시 */ }
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: REDIRECT });
    if (error) throw error;
  }
  async function updatePassword(password) {
    const { data, error } = await client.auth.updateUser({ password });
    if (error) throw error;
    try { localStorage.removeItem(RECOVERY_FLAG); } catch (_) { /* 무시 */ }
    user = data.user;
    return user;
  }
  // 메일 링크로 앱이 열렸을 때: haruplanner://auth-callback?code=... → 로그인
  async function handleAuthUrl(url) {
    let u;
    try { u = new URL(url); } catch (_) { return { ok: false, error: '잘못된 링크예요' }; }
    const q = new URLSearchParams(u.search);
    const h = new URLSearchParams((u.hash || '').replace(/^#/, ''));
    const errDesc = q.get('error_description') || h.get('error_description');
    if (errDesc) return { ok: false, error: errDesc.replace(/\+/g, ' ') };
    const code = q.get('code');
    if (!code) return { ok: false, error: '링크에 로그인 정보가 없어요' };
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) return { ok: false, error: error.message };
    user = data.user;
    let recovery = data.redirectType === 'recovery';
    try { if (localStorage.getItem(RECOVERY_FLAG) === '1') recovery = true; } catch (_) { /* 무시 */ }
    return { ok: true, user, recovery };
  }
  // 계정 삭제: DB 함수 delete_my_account() 가 본인 일정·설정과 계정을 함께 지워요
  async function deleteAccount() {
    stop();
    const { error } = await client.rpc('delete_my_account');
    if (!error) { await signOut(); return { ok: true, accountDeleted: true }; }
    // 함수가 아직 없으면 본인 데이터만이라도 지워요
    if (/delete_my_account|PGRST202|function/i.test(`${error.code} ${error.message}`)) {
      const a = await client.from(EVENTS).delete().eq('user_id', user.id);
      const b = await client.from(META).delete().eq('user_id', user.id);
      if (a.error || b.error) throw a.error || b.error;
      await signOut();
      return { ok: true, accountDeleted: false };
    }
    throw error;
  }

  async function fetchTable(table, cols) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select(cols).range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  }
  async function fetchAll() {
    const [ev, meta] = await Promise.all([
      fetchTable(EVENTS, 'id,client_id,title,start_at,end_at,created_at,details'),
      fetchTable(META, 'kind,id,data'),
    ]);
    return [...ev.map(eventRow), ...meta.map((r) => ({ kind: r.kind, id: r.id, data: r.data }))];
  }

  // ---------- 실시간 받기 ----------
  function applyIncoming(r, silent) {
    const k = `${r.kind}:${r.id}`;
    remember(r);
    const v = Number(r.data && r.data._v) || 0;
    const obj = strip(r.data);
    const s = stable(obj);
    if (synced.get(k) === s) return false; // 이미 알고 있는 내용
    const known = ver.get(k) || 0;
    if (known > v) return false; // 이 PC에 더 새로운 변경이 있어요
    if (known && known === v && localStr(getData(), k) !== synced.get(k)) return false; // 내가 올린 것의 메아리 + 그 뒤 또 고침
    applyRowTo(getData(), r.kind, r.id, obj);
    synced.set(k, s);
    ver.set(k, v);
    if (!silent) onRemote();
    return true;
  }
  function removeIncoming(k) {
    if (!synced.has(k)) return;
    const i = k.indexOf(':');
    synced.delete(k);
    ver.delete(k);
    forget(k);
    removeFrom(getData(), k.slice(0, i), k.slice(i + 1));
    onRemote();
  }
  function onEvents(p) {
    if (!active) return;
    if (p.eventType === 'DELETE') {
      const o = p.old || {};
      const k = (o.id != null && keyOfSid.get(String(o.id))) || (o.client_id ? `task:${o.client_id}` : null);
      if (k) removeIncoming(k);
      return;
    }
    if (p.new && p.new.id != null) applyIncoming(eventRow(p.new), false);
  }
  function onMeta(p) {
    if (!active) return;
    if (p.eventType === 'DELETE') {
      const o = p.old || {};
      if (o.kind && o.id) removeIncoming(`${o.kind}:${o.id}`);
      return;
    }
    if (p.new && p.new.kind) applyIncoming({ kind: p.new.kind, id: p.new.id, data: p.new.data }, false);
  }
  function subscribe() {
    if (unsub) unsub();
    const ch = client.channel('haru-planner-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: EVENTS }, onEvents)
      .on('postgres_changes', { event: '*', schema: 'public', table: META }, onMeta)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          if (status !== 'syncing') setStatus('online');
          if (wasDown) { wasDown = false; resync(); }
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          wasDown = true;
          if (active) setStatus('offline', '실시간 연결이 끊겼어요. 다시 연결하는 중…');
        }
      });
    unsub = () => { try { client.removeChannel(ch); } catch (_) { /* 무시 */ } };
  }

  // ---------- 올리기 ----------
  function schedulePush(delay = 300) {
    if (!active) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push(); }, delay);
  }
  function push() {
    if (!active) return Promise.resolve();
    if (pushing) { again = true; return pushing; }
    pushing = doPush().finally(() => {
      pushing = null;
      if (again) { again = false; schedulePush(50); }
    });
    return pushing;
  }
  async function doPush() {
    try {
      const now = entities(getData());
      const tasks = [];
      const metas = [];
      const delTasks = [];
      const delMetas = [];
      const stamp = new Date().toISOString();
      for (const [k, e] of now) {
        const s = stable(e.obj);
        if (synced.get(k) === s) continue;
        const v = Math.max(Date.now(), (ver.get(k) || 0) + 1);
        if (e.kind === 'task') {
          tasks.push({ k, s, v, row: { user_id: user.id, client_id: e.id, title: e.obj.title || '제목 없음', ...taskTimes(e.obj), details: { ...e.obj, _v: v }, updated_at: stamp } });
        } else {
          metas.push({ k, s, v, row: { user_id: user.id, kind: e.kind, id: e.id, data: { ...e.obj, _v: v }, updated_at: stamp } });
        }
      }
      for (const k of synced.keys()) if (!now.has(k)) (k.startsWith('task:') ? delTasks : delMetas).push(k);
      if (!tasks.length && !metas.length && !delTasks.length && !delMetas.length) { setStatus('online'); return; }
      setStatus('syncing');

      // 다른 곳에서 client_id 없이 만든 events 줄은 id로 고쳐요 (그러면서 client_id 를 붙여요)
      const byId = tasks.filter((u) => noCid.has(u.k) && sidOf.has(u.k));
      const byCid = tasks.filter((u) => !byId.includes(u));
      for (const u of byId) {
        const { error } = await client.from(EVENTS).update(u.row).eq('id', sidOf.get(u.k));
        if (error) throw error;
        noCid.delete(u.k);
        synced.set(u.k, u.s);
        ver.set(u.k, u.v);
      }
      for (let i = 0; i < byCid.length; i += 300) {
        const chunk = byCid.slice(i, i + 300);
        const { data, error } = await client.from(EVENTS).upsert(chunk.map((u) => u.row), { onConflict: 'user_id,client_id' }).select('id,client_id');
        if (error) throw error;
        for (const r of data || []) remember({ kind: 'task', id: r.client_id, sid: r.id, hasCid: true });
        chunk.forEach((u) => { synced.set(u.k, u.s); ver.set(u.k, u.v); });
      }
      for (let i = 0; i < metas.length; i += 500) {
        const chunk = metas.slice(i, i + 500);
        const { error } = await client.from(META).upsert(chunk.map((u) => u.row), { onConflict: 'user_id,kind,id' });
        if (error) throw error;
        chunk.forEach((u) => { synced.set(u.k, u.s); ver.set(u.k, u.v); });
      }

      // 지우기
      const sids = delTasks.filter((k) => sidOf.has(k));
      const cids = delTasks.filter((k) => !sidOf.has(k)).map((k) => k.slice(5));
      for (let i = 0; i < sids.length; i += 200) {
        const part = sids.slice(i, i + 200);
        const { error } = await client.from(EVENTS).delete().in('id', part.map((k) => sidOf.get(k)));
        if (error) throw error;
        part.forEach((k) => { synced.delete(k); ver.delete(k); forget(k); });
      }
      for (let i = 0; i < cids.length; i += 200) {
        const part = cids.slice(i, i + 200);
        const { error } = await client.from(EVENTS).delete().in('client_id', part);
        if (error) throw error;
        part.forEach((id) => { synced.delete(`task:${id}`); ver.delete(`task:${id}`); });
      }
      const byKind = new Map();
      for (const k of delMetas) {
        const i = k.indexOf(':');
        const kind = k.slice(0, i);
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push(k.slice(i + 1));
      }
      for (const [kind, ids] of byKind) {
        for (let i = 0; i < ids.length; i += 200) {
          const part = ids.slice(i, i + 200);
          const { error } = await client.from(META).delete().eq('kind', kind).in('id', part);
          if (error) throw error;
          part.forEach((id) => { synced.delete(`${kind}:${id}`); ver.delete(`${kind}:${id}`); });
        }
      }
      setStatus('online');
    } catch (err) {
      const m = String((err && (err.message || err.code)) || err);
      setStatus('offline', /column|relation|does not exist|could not find the table|42703|42P01|PGRST20/i.test(m)
        ? `DB 설정이 아직 안 됐어요: supabase/schema.sql 을 실행해 주세요 (${m})`
        : '저장하지 못한 변경이 있어요. 연결되면 자동으로 올려요.');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => push(), 5000);
    }
  }

  // 끊겼다 다시 연결되면 서버 전체와 한 번 맞춰요
  async function resync() {
    if (!active) return;
    try {
      const rows = await fetchAll();
      const data = getData();
      const seen = new Set();
      let changed = false;
      for (const r of rows) {
        seen.add(`${r.kind}:${r.id}`);
        if (applyIncoming(r, true)) changed = true;
      }
      for (const k of [...synced.keys()]) {
        if (seen.has(k)) continue;
        // 다른 PC에서 지운 항목: 이 PC에서 고치지 않았으면 지우고, 고쳤으면 다시 올려요
        if (localStr(data, k) === synced.get(k)) {
          const i = k.indexOf(':');
          removeFrom(data, k.slice(0, i), k.slice(i + 1));
          changed = true;
        }
        synced.delete(k);
        ver.delete(k);
        forget(k);
      }
      if (changed) onRemote();
      schedulePush(0);
    } catch (_) {
      setStatus('offline', '인터넷 연결을 기다리는 중…');
      setTimeout(resync, 8000);
    }
  }

  function start(rows, getDataFn, onRemoteFn) {
    getData = getDataFn;
    onRemote = onRemoteFn;
    synced.clear();
    ver.clear();
    sidOf.clear();
    keyOfSid.clear();
    noCid.clear();
    for (const r of rows) {
      const k = `${r.kind}:${r.id}`;
      remember(r);
      synced.set(k, stable(strip(r.data)));
      ver.set(k, Number(r.data && r.data._v) || 0);
    }
    active = true;
    setStatus('online');
    subscribe();
    schedulePush(0); // 처음 정리(형식 맞춤 등)로 달라진 항목이 있으면 올려요
  }
  function stop() {
    active = false;
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    if (unsub) { unsub(); unsub = null; }
    setStatus('off');
  }
  async function flushNow(timeoutMs = 4000) {
    if (!active) return;
    clearTimeout(pushTimer);
    await Promise.race([push(), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  window.addEventListener('online', () => { if (active) resync(); });

  return {
    config, saveConfig, connect, currentUser, signIn, signOut, fetchAll, buildData, start, stop,
    signUp, resendSignup, verifyCode, sendReset, updatePassword, handleAuthUrl, deleteAccount,
    setRemember, remembering, REDIRECT,
    schedulePush, push, flushNow, resync, saveDevice, deviceSettings,
    isActive: () => active,
    user: () => user,
    status: () => ({ status, msg: statusMsg }),
    onStatus: (f) => { listeners.add(f); return () => listeners.delete(f); },
    pendingCount: () => {
      if (!active) return 0;
      let n = 0;
      for (const [k, e] of entities(getData())) if (synced.get(k) !== stable(e.obj)) n++;
      for (const k of synced.keys()) if (localStr(getData(), k) === undefined) n++;
      return n;
    },
    _test: { taskTimes, datesFromTimes, eventToTask, stable },
  };
})();
