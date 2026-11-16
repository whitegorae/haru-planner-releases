'use strict';

/* =========================================================================
 * 구글 캘린더 연동 (데스크톱 · 폰 같이 써요)
 *  실제 동기화는 Supabase 서버 함수(gcal-sync)가 해요 → PC · 폰이 꺼져 있어도 1분 안에 맞춰져요.
 *  - 하루플래너에서 바꾸면: DB 트리거가 서버를 바로 깨워서 몇 초 안에 구글로
 *  - 구글에서 바꾸면: 서버가 30초마다 확인해서 하루플래너로 → 실시간으로 모든 기기에
 *  앱은 "연동하기"(구글 동의 화면 열기) · 캘린더 고르기 · 연결 끊기만 해요. 구글 토큰은 앱에 오지 않아요.
 * ========================================================================= */

const CalSync = (() => {
  const st = { ready: false, notReady: false, link: null, waiting: false, calendars: null, busy: false, error: null };
  const listeners = new Set();
  let pollT = 0;
  let waitUntil = 0;
  const emit = () => listeners.forEach((f) => { try { f(st); } catch (_) { /* 무시 */ } });
  const cli = () => (typeof Cloud !== 'undefined' && Cloud.isActive() ? Cloud.client() : null);
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch (_) { return 'Asia/Seoul'; } };
  const nonce = () => {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
  };

  async function refresh() {
    const c = cli();
    const u = typeof Cloud !== 'undefined' && Cloud.user();
    if (!c || !u) { st.ready = false; emit(); return st; }
    const { data, error } = await c.from('gcal_links').select('email,calendar_id,list_id,tz,enabled,last_sync,last_error').eq('user_id', u.id).maybeSingle();
    if (error) {
      st.notReady = /relation|does not exist|42P01|PGRST20|schema cache/i.test(error.message || '');
      st.error = st.notReady ? null : error.message;
    } else {
      st.notReady = false;
      const had = !!st.link;
      st.link = data || null;
      if (st.link && st.waiting) { st.waiting = false; stopWait(); }
      if (st.link && !had) loadCalendars();
      if (!st.link) st.calendars = null;
    }
    st.ready = true;
    emit();
    return st;
  }

  async function call(action, extra = {}) {
    const c = cli();
    if (!c) throw new Error('로그인이 필요해요');
    const { data, error } = await c.functions.invoke('gcal-sync', { body: { action, ...extra } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (_) { /* 무시 */ }
      throw new Error(msg);
    }
    return data;
  }

  async function loadCalendars() {
    try { st.calendars = (await call('calendars')).calendars || []; } catch (e) { st.error = e.message; }
    emit();
  }

  function stopWait() { clearInterval(pollT); pollT = 0; }

  // 연동하기: 일회용 번호를 적고 → 브라우저로 구글 동의 화면을 열어요 → 허용하면 서버가 연결을 저장해요
  async function connect(openUrl, listId = 'inbox') {
    const c = cli();
    const u = typeof Cloud !== 'undefined' && Cloud.user();
    if (!c || !u) throw new Error('먼저 로그인해 주세요');
    const n = nonce();
    const { error } = await c.from('gcal_oauth_state').insert({ nonce: n, user_id: u.id, tz: tz(), list_id: listId });
    if (error) throw new Error(/relation|does not exist|42P01|PGRST20|schema cache/i.test(error.message) ? '서버 준비가 아직 안 됐어요 (deploy-gcal)' : error.message);
    const cfg = Cloud.config();
    const base = String((cfg && cfg.url) || c.supabaseUrl || '').replace(/\/$/, '');
    if (!base) throw new Error('서버 주소를 찾지 못했어요');
    openUrl(`${base}/functions/v1/gcal-auth?nonce=${n}`);
    st.waiting = true;
    st.error = null;
    emit();
    // 허용할 때까지 3초마다 확인 (최대 5분)
    stopWait();
    waitUntil = Date.now() + 5 * 60 * 1000;
    pollT = setInterval(() => { if (Date.now() > waitUntil) { st.waiting = false; stopWait(); emit(); return; } refresh(); }, 3000);
  }
  function cancelWait() { st.waiting = false; stopWait(); emit(); }

  async function run(action, extra) {
    st.busy = true;
    st.error = null;
    emit();
    try { await call(action, extra); } catch (e) { st.error = e.message; }
    st.busy = false;
    await refresh();
  }

  async function disconnect() {
    st.busy = true;
    emit();
    try { await call('disconnect'); st.link = null; st.calendars = null; } catch (e) { st.error = e.message; }
    st.busy = false;
    await refresh();
  }

  // 앱으로 돌아오면 상태를 다시 읽어요 (브라우저에서 허용하고 돌아온 경우)
  const onBack = () => { if (!document.hidden && cli()) refresh(); };
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);

  return {
    status: () => st,
    onStatus: (f) => { listeners.add(f); return () => listeners.delete(f); },
    refresh,
    connect,
    cancelWait,
    loadCalendars,
    setCalendar: (id) => run('settings', { calendar_id: id }),
    setList: (id) => run('settings', { list_id: id }),
    syncNow: () => run('sync'),
    disconnect,
  };
})();
