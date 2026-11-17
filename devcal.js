'use strict';

/* =========================================================================
 * 폰 캘린더(삼성 캘린더 등) ↔ 하루플래너 — 안드로이드 앱(1.3.0~)에서만
 *  - 고른 폰 캘린더의 일정 ↔ 날짜가 있는 할 일 (지난 30일 ~ 앞으로 1년)
 *  - 앱이 켜져 있는 동안: 폰 캘린더가 바뀌면 바로, 그 밖에도 30초마다 맞춰요
 *  - 하루플래너에서 바꾼 건 몇 초 안에 폰 캘린더로 (다른 기기에서 바꾼 것도 실시간으로 받아서 보내요)
 *  - 연결 정보(폰 일정 id ↔ 할 일 id)는 이 폰에만 저장해요
 *  - 구글 계정 캘린더는 고르지 않아요 → 구글은 서버 연동(CalSync)이 맡아요 (두 번 생기지 않게)
 *  - 반복 일정은 건너뛰어요. 끝낸 할 일은 폰 캘린더에 "✓ 제목" 으로 보여요.
 *  - 삼성 캘린더의 "할 일"(일정과 따로 저장돼요)도 가져와요 (APK 1.5.0~). 하루플래너에서 체크하면 삼성 할 일에도 완료로 표시해요.
 * 이 파일은 mobile.js 의 state · taskById · makeTask · commit · taskEnd 를 실행 중에 써요.
 * ========================================================================= */

const DevCal = (() => {
  // 앱이 닫혀 있을 때 폰이 숨은 화면으로 이 앱을 열면(?bg=devcal) window.HaruBg 로 폰 캘린더를 읽고 써요 (APK 1.6.0~)
  const bgBridge = !window.Capacitor && window.HaruBg ? {
    isPluginAvailable: (n) => n === 'HaruCalendar',
    Plugins: {
      HaruCalendar: new Proxy({}, {
        get: (_, m) => {
          if (m === 'addListener') return () => ({ remove() {} });
          return (o) => {
            let r;
            try { r = JSON.parse(window.HaruBg.call(String(m), JSON.stringify(o || {}))); } catch (e) { return Promise.reject(e); }
            return r && r.ok ? Promise.resolve(r.data || {}) : Promise.reject(new Error((r && r.error) || 'error'));
          };
        },
      }),
    },
  } : null;
  const C = window.Capacitor || bgBridge;
  const available = !!(C && ((C.isPluginAvailable && C.isPluginAvailable('HaruCalendar')) || (Array.isArray(C.PluginHeaders) && C.PluginHeaders.some((h) => h.name === 'HaruCalendar'))));
  const call = (m, o = {}) => {
    try {
      const p = C && C.Plugins && C.Plugins.HaruCalendar;
      if (p && typeof p[m] === 'function') return Promise.resolve(p[m](o));
      if (C && typeof C.nativePromise === 'function') return C.nativePromise('HaruCalendar', m, o);
    } catch (e) { return Promise.reject(e); }
    return Promise.reject(new Error(`${m}() is not implemented`));
  };
  const KEY = 'haru-devcal';
  // 가져올 기간: 'all' 전체(기본) · '365' 최근 1년 · '30' 최근 30일 — 앞으로는 10년 뒤까지
  const PAST_OPTS = { all: null, 365: 365, 30: 30 };
  const PUSH_PAST = 30; // 하루플래너 → 폰: 끝난 옛 할 일이 쏟아지지 않게 최근 30일부터만 새로 보내요
  const FUTURE = 3650;
  const POLL_MS = 30 * 1000;
  const DONE = '✓ ';
  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  let cfg = loadCfg();
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) { /* 무시 */ } };
  // 앱 화면과 (앱이 닫혀 있을 때의) 숨은 화면이 같은 저장소를 써요 → 동시에 맞추지 않게 잠깐 잠가요
  const LOCK = 'haru-devcal-lock';
  const me = Math.random().toString(36).slice(2);
  function takeLock() {
    try {
      const l = JSON.parse(localStorage.getItem(LOCK) || 'null');
      if (l && l.o !== me && l.u > Date.now()) return false;
      localStorage.setItem(LOCK, JSON.stringify({ o: me, u: Date.now() + 40000 }));
      return true;
    } catch (_) { return true; }
  }
  function dropLock() { try { const l = JSON.parse(localStorage.getItem(LOCK) || 'null'); if (l && l.o === me) localStorage.removeItem(LOCK); } catch (_) { /* 무시 */ } }
  // 이 화면에서 한 번이라도 본 할 일 (오래된 데이터로 폰 일정을 지우지 않게)
  const seenTids = new Set();
  const nowAt = () => Date.now();
  const st = { available, granted: false, calendars: null, busy: false, lastAt: null, error: null, warn: null };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(st); } catch (_) { /* 무시 */ } });
  let running = false;
  let again = false;
  let schedT = 0;
  let pollT = 0;
  let started = false;

  const p2 = (n) => String(n).padStart(2, '0');
  const ymdLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const hmLocal = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const ymdUTC = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
  const localMs = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = (time || '00:00').split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
  const utcMs = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); };

  const fpOf = (e) => JSON.stringify([e.title || '', e.notes || '', Number(e.start) || 0, Number(e.end) || 0, !!e.allDay]);
  const hashOf = (t) => JSON.stringify([t.title || '', t.notes || '', t.dueDate || null, t.dueDate ? taskEnd(t) : null, t.dueTime || null, t.endTime || null, !!t.done]);

  // 폰 일정 → 할 일 칸
  function fieldsOf(ev, m) {
    let title = String(ev.title || '').trim();
    let done = false;
    if (title.startsWith(DONE.trim())) { done = true; title = title.slice(DONE.trim().length).trim(); }
    const f = { title: title || '제목 없음', notes: String(ev.notes || ''), done };
    const end = Number(ev.end) || Number(ev.start);
    if (ev.allDay) {
      f.dueDate = ymdUTC(ev.start);
      const last = ymdUTC(Math.max(Number(ev.start), end - 86400000));
      f.endDate = last > f.dueDate ? last : null;
      f.dueTime = null;
      f.endTime = null;
    } else {
      f.dueDate = ymdLocal(ev.start);
      f.dueTime = hmLocal(ev.start);
      f.endDate = null;
      f.endTime = null;
      if (end > ev.start) {
        const lastD = ymdLocal(end);
        if (lastD > f.dueDate && hmLocal(end) === '00:00') { const prev = addDays(lastD, -1); f.endDate = prev > f.dueDate ? prev : null; } else {
          f.endDate = lastD > f.dueDate ? lastD : null;
          f.endTime = hmLocal(end);
          if (!f.endDate && m && m.noEnd && end - ev.start === 30 * 60000) f.endTime = null;
        }
      }
    }
    return f;
  }
  // 할 일 → 폰 일정
  function eventOf(t) {
    const last = taskEnd(t);
    const e = { title: (t.done ? DONE : '') + (t.title || '제목 없음'), notes: t.notes || '', allDay: !t.dueTime, noEnd: false };
    if (!t.dueTime) { e.start = utcMs(t.dueDate); e.end = utcMs(addDays(last, 1)); } else {
      e.start = localMs(t.dueDate, t.dueTime);
      if (t.endTime) e.end = localMs(last, t.endTime);
      else if (last !== t.dueDate) e.end = localMs(addDays(last, 1), null);
      else { e.end = e.start + 30 * 60000; e.noEnd = true; } // 끝 시각이 없으면 30분짜리로
    }
    return e;
  }

  async function checkPerm() {
    if (!available) return false;
    try { st.granted = !!(await call('permission')).granted; } catch (_) { st.granted = false; }
    return st.granted;
  }
  async function loadCalendars() {
    try {
      st.calendars = ((await call('calendars')).calendars || []).map((c) => ({
        ...c,
        google: /google/i.test(c.accountType || ''),
        holiday: /공휴일|휴일|holiday|기념일|생일|birthday|날씨|weather|음력/i.test(`${c.name || ''} ${c.account || ''} ${c.accountType || ''}`),
      }));
    } catch (e) { st.error = e.message; }
    emit();
    return st.calendars || [];
  }
  // 구글 서버 연동(CalSync)을 켰으면 폰의 구글 계정 캘린더는 그쪽이 맡아요 (두 번 생기지 않게)
  const serverGoogle = () => typeof CalSync !== 'undefined' && !!(CalSync.status() && CalSync.status().link);
  // 기본으로 맞출 캘린더: 쓰기 가능한 내 캘린더 (공휴일 · 생일처럼 읽기 전용은 빼요. 하루플래너가 공휴일을 따로 보여줘요)
  const usable = (c) => c.writable && !c.holiday && c.visible !== false && (!c.google || !serverGoogle());
  function pickTarget(cals) {
    const w = cals.filter(usable);
    const pick = w.find((c) => /samsung|osp/i.test(c.accountType || '')) || w.find((c) => /local/i.test(c.accountType || '')) || w.find((c) => !c.google) || w[0];
    return pick ? pick.id : null;
  }
  function applyDefaults(cals) {
    cfg.calIds = cals.filter(usable).map((c) => c.id);
    if (!cfg.target || !cals.some((c) => c.id === cfg.target && usable(c))) cfg.target = pickTarget(cals);
  }

  // ---------- 삼성 캘린더 "할 일" ----------
  // 삼성 캘린더의 할 일은 안드로이드 표준 "일정"이 아니라 삼성 전용 저장소에 있어요 (APK 1.5.0~ 에서 읽어요)
  const taskFp = (f) => JSON.stringify([f.title, f.notes, f.dueDate || null, !!f.done]);
  const taskHash = (t) => JSON.stringify([t.title || '', t.notes || '', t.dueDate || null, !!t.done]);
  function taskFieldsOf(k) {
    const f = { title: String(k.title || '').trim() || '제목 없음', notes: String(k.notes || ''), done: !!k.done };
    const due = Number(k.due) || 0;
    f.dueDate = due > 0 ? (k.dueUtc ? ymdUTC(due) : ymdLocal(due)) : null;
    return f;
  }
  async function pullSamsungTasks() {
    const res = { changed: false, pulled: 0 };
    if (cfg.tasks === false) return res;
    let r;
    try { r = await call('tasks'); } catch (e) {
      // 예전 APK(할 일 읽기 없음) 또는 읽기 오류
      st.tasks = { supported: false, why: /not implemented|unimplemented|is not a function|no bridge/i.test(String(e && e.message)) ? 'old-app' : String((e && e.message) || e) };
      return res;
    }
    if (!r || !r.supported) { st.tasks = { supported: false, why: (r && r.why) || '' }; return res; }
    const list = Array.isArray(r.tasks) ? r.tasks : [];
    const tmap = (cfg.tmap = cfg.tmap || {});
    const seen = new Set();
    const listId = state.data.lists.some((l) => l.id === cfg.listId) ? cfg.listId : 'inbox';
    for (const k of list) {
      if (!k || !k.id) continue;
      seen.add(k.id);
      const f = taskFieldsOf(k);
      const fp = taskFp(f);
      let m = tmap[k.id];
      if (m && m.skip) { if (f.done) continue; delete tmap[k.id]; m = undefined; } // 끝냈던 옛 할 일을 다시 "안 끝남"으로 바꿨어요 → 이제 가져와요
      let t = m ? taskById(m.tid) : null;
      if (m && !t) continue; // 하루플래너에서 지운 할 일 → 삼성 쪽은 그대로 두고 다시 가져오지 않아요
      if (m && m.fp === fp) {
        // 삼성 쪽은 그대로인데 하루플래너에서 체크 · 해제했으면 → 삼성 할 일에도 표시해요
        if (t && !!t.done !== f.done) {
          try { await call('taskDone', { id: k.id, done: !!t.done }); m.fp = taskFp({ ...f, done: !!t.done }); } catch (_) { /* 다음에 */ }
        }
        m.h = taskHash(t);
        continue;
      }
      if (m && t && taskHash(t) !== m.h) { m.fp = fp; continue; } // 양쪽에서 다 고쳤으면 하루플래너 쪽을 남겨요
      if (!t) {
        if (f.done) { tmap[k.id] = { tid: '', fp, h: '', skip: true }; continue; } // 이미 끝낸 옛 할 일은 가져오지 않아요
        t = makeTask({ ...f, listId, doneAt: null });
        state.data.tasks.push(t);
      } else {
        if (f.done !== !!t.done) t.doneAt = f.done ? Date.now() : null;
        if (t.dueDate !== f.dueDate) t.reminded = null;
        Object.assign(t, f);
      }
      tmap[k.id] = { tid: t.id, fp, h: taskHash(t), at: nowAt() };
      res.changed = true;
      res.pulled++;
    }
    // 삼성에서 지운 할 일 → 하루플래너에서도 (하루플래너에서 고치지 않은 것만, 한꺼번에 많이 사라지면 지우지 않아요)
    const gone = Object.keys(tmap).filter((id) => !seen.has(id));
    const real = gone.filter((id) => tmap[id].tid);
    if (real.length > 20 && real.length > Object.keys(tmap).length * 0.5) st.warn = `삼성 할 일 ${real.length}개가 한꺼번에 사라져서, 안전을 위해 하루플래너에서는 지우지 않았어요.`;
    else {
      for (const id of gone) {
        const m = tmap[id];
        const t = m.tid ? taskById(m.tid) : null;
        if (t && taskHash(t) === m.h) { state.data.tasks = state.data.tasks.filter((x) => x !== t); res.changed = true; }
        delete tmap[id];
      }
    }
    st.tasks = { supported: true, count: list.filter((k) => !k.done).length, linked: Object.values(tmap).filter((x) => x.tid).length };
    return res;
  }

  let halted = false; // 숨은 동기화 화면: 한 번 맞춘 뒤로는 더 돌지 않아요 (곧 닫혀요)
  async function sync() {
    if (halted || !available || !cfg.on || !st.granted || !state.data) return;
    if (typeof canEdit === 'function' && state.offline) return;
    if (running) { again = true; return; }
    if (!takeLock()) { schedule(3000); return; } // 다른 화면(앱이 닫혀 있을 때의 숨은 동기화)이 맞추는 중
    // 다른 화면이 고친 연결 정보를 가져와요 (이 화면의 옛 정보로 덮어쓰면 할 일이 두 번 생겨요)
    cfg = loadCfg();
    if (!cfg.on) { dropLock(); return; }
    running = true;
    st.busy = true;
    st.error = null;
    emit();
    let changed = false;
    for (const t of state.data.tasks) seenTids.add(t.id);
    try {
      cfg.map = cfg.map || {};
      const map = cfg.map;
      const cals = st.calendars || await loadCalendars();
      const calOf = new Map(cals.map((c) => [c.id, c]));
      // 예전 설정(공휴일까지 다 고르고 구글은 빼던 것) → 새 기본값으로 한 번 바꿔요
      if (cfg.v !== 2 && cals.length) { applyDefaults(cals); cfg.v = 2; }
      // 구글 서버 연동을 켰으면 폰의 구글 캘린더는 빼요 (서버가 같은 일정을 이어 붙여요)
      if (serverGoogle()) {
        cfg.calIds = (cfg.calIds || []).filter((id) => !(calOf.get(id) || {}).google);
        if ((calOf.get(cfg.target) || {}).google) cfg.target = pickTarget(cals);
      }
      const ids = [...new Set([...(cfg.calIds || []), cfg.target].filter(Boolean))];
      const today = todayStr();
      const pastDays = Object.prototype.hasOwnProperty.call(PAST_OPTS, String(cfg.past)) ? PAST_OPTS[String(cfg.past)] : null;
      const from = pastDays === null ? 0 : localMs(addDays(today, -pastDays), null);
      const minDate = addDays(today, -PUSH_PAST);
      const { events = [] } = await call('events', { calIds: ids, from, to: localMs(addDays(today, FUTURE), null) });
      const seen = new Set();
      let skippedRepeat = 0;
      let pulledNow = 0;
      let pushedNow = 0;

      // 1) 폰 캘린더 → 하루플래너
      for (const ev of events) {
        if (ev.rrule) { skippedRepeat++; continue; } // 반복 일정은 건너뛰어요
        seen.add(ev.id);
        if (map[ev.id]) map[ev.id].calId = ev.calId;
        const fp = fpOf(ev);
        const m = map[ev.id];
        let t = m ? taskById(m.tid) : null;
        if (m && m.fp === fp) continue; // 그대로
        if (!t && m) continue; // 하루플래너에서 지운 할 일 → 3) 에서 폰에서도 지워요
        const f = fieldsOf(ev, m);
        if (!m) { // 처음 보는 폰 일정: 제목 · 날짜 · 시각이 같은 할 일이 아직 연결 안 돼 있으면 새로 만들지 않고 이어 붙여요
          const key = `${f.title.trim().toLowerCase()}|${f.dueDate}|${f.dueTime || ''}`;
          const linkedTids = new Set([...Object.values(map), ...Object.values(cfg.tmap || {})].map((x) => x.tid));
          const same = state.data.tasks.find((x) => !linkedTids.has(x.id) && x.dueDate && `${String(x.title || '').trim().toLowerCase()}|${x.dueDate}|${x.dueTime || ''}` === key);
          if (same) { map[ev.id] = { tid: same.id, fp, h: hashOf({ ...same, ...f }), noEnd: false, calId: ev.calId, src: 'link', at: nowAt() }; continue; }
        }
        // 양쪽에서 다 고쳤으면 하루플래너 쪽을 남겨요 (폰 캘린더는 고친 시각을 알려주지 않아서) → 2) 에서 폰 일정을 고쳐요
        if (m && t && hashOf(t) !== m.h) { m.fp = fp; continue; }
        if (!t) {
          t = makeTask({ ...f, listId: state.data.lists.some((l) => l.id === cfg.listId) ? cfg.listId : 'inbox', doneAt: f.done ? Date.now() : null });
          state.data.tasks.push(t);
        } else {
          if (f.done !== !!t.done) t.doneAt = f.done ? Date.now() : null;
          if (t.dueDate !== f.dueDate || t.dueTime !== f.dueTime) t.reminded = null;
          Object.assign(t, f);
        }
        map[ev.id] = { tid: t.id, fp, h: hashOf(t), noEnd: !!(m && m.noEnd && !t.endTime && t.dueTime), calId: ev.calId, src: (m && m.src) || 'dev', at: nowAt() };
        changed = true;
        pulledNow++;
      }
      // 폰에서 지운 일정 (안 보이는 것만 따로 확인해요: 기간 밖으로 옮긴 건 지우지 않아요)
      const missing = Object.keys(map).filter((id) => !seen.has(id));
      if (missing.length) {
        const { events: alive = [] } = await call('existing', { ids: missing });
        const still = new Set(alive.map((e) => e.id));
        for (const e of alive) if (map[e.id]) map[e.id].calId = e.calId;
        // 고르지 않은 캘린더의 일정 정리: 폰에서 가져온 건(안 고친 것만) 하루플래너에서 빼고, 하루플래너가 넣은 건 폰에서 빼요
        for (const e of alive) {
          const m = map[e.id];
          if (!m || ids.includes(e.calId)) continue;
          const c = calOf.get(e.calId) || {};
          const t = taskById(m.tid);
          const handOver = c.google && serverGoogle(); // 구글 서버 연동이 넘겨받아요 → 할 일 · 폰 일정 모두 그대로 두고 연결만 끊어요
          if (handOver) { /* 그대로 */ } else if (m.src === 'haru') await call('remove', { id: e.id }).catch(() => {});
          else if (m.src !== 'link' && t && hashOf(t) === m.h) { state.data.tasks = state.data.tasks.filter((x) => x !== t); changed = true; }
          delete map[e.id];
        }
        const gone = missing.filter((id) => !still.has(id));
        if (gone.length > 50 && gone.length > Object.keys(map).length * 0.5) st.warn = `폰 캘린더에서 일정 ${gone.length}개가 한꺼번에 사라져서, 안전을 위해 할 일은 지우지 않았어요.`;
        else {
          for (const id of gone) {
            const t = taskById(map[id].tid);
            if (t) { state.data.tasks = state.data.tasks.filter((x) => x !== t); changed = true; }
            delete map[id];
          }
        }
      }

      // 1-2) 삼성 캘린더 "할 일" → 하루플래너 (일정과 따로 저장돼 있어요)
      const tr = await pullSamsungTasks();
      if (tr.changed) changed = true;
      pulledNow += tr.pulled;
      const fromTasks = new Set(Object.values(cfg.tmap || {}).map((x) => x.tid));

      // 2) 하루플래너 → 폰 캘린더
      if (cfg.push !== false && cfg.target) {
        const evOf = new Map(Object.entries(map).map(([eid, m]) => [m.tid, eid]));
        for (const t of state.data.tasks) {
          if (fromTasks.has(t.id) && !evOf.has(t.id)) continue; // 삼성 "할 일"에서 온 건 일정으로 또 넣지 않아요
          const eid = evOf.get(t.id);
          const m = eid ? map[eid] : null;
          if (!t.dueDate) { if (m) { await call('remove', { id: eid }).catch(() => {}); delete map[eid]; } continue; }
          if (!m && taskEnd(t) < minDate) continue;
          const h = hashOf(t);
          if (m && m.h === h) continue;
          const e = eventOf(t);
          const r = await call('upsert', { id: eid || null, calId: (m && m.calId) || cfg.target, title: e.title, notes: e.notes, start: e.start, end: e.end, allDay: e.allDay });
          if (eid && r.id !== eid) delete map[eid];
          map[r.id] = { tid: t.id, fp: fpOf(e), h, noEnd: e.noEnd, calId: (m && m.calId) || cfg.target, src: (m && m.src) || 'haru', at: nowAt() };
          pushedNow++;
        }
      }
      if (cfg.push !== false && !cfg.target) st.warn = '할 일을 넣을 수 있는 폰 캘린더가 없어요. 아래에서 "할 일을 넣을 캘린더"를 골라 주세요.';
      // 상태 보여주기용: 연결된 일정 수 + 이번에 가져온 · 보낸 수 (누적은 앱을 연 뒤부터)
      st.total = st.total || { pulled: 0, pushed: 0 };
      st.total.pulled += pulledNow;
      st.total.pushed += pushedNow;
      st.counts = { linked: Object.keys(map).length, pulledNow, pushedNow, pulledTotal: st.total.pulled, pushedTotal: st.total.pushed, skippedRepeat };
      // 3) 하루플래너에서 지운 할 일 → 폰에서도 지우기
      //    단, 이 화면이 그 할 일을 본 적이 없고 데이터가 연결보다 오래됐으면(다른 화면이 방금 만든 연결) 지우지 않아요
      for (const [eid, m] of Object.entries(map)) {
        if (taskById(m.tid)) continue;
        if (!seenTids.has(m.tid) && !(m.at ? (state.dataAt || 0) > m.at + 3000 : true)) continue;
        await call('remove', { id: eid }).catch(() => {});
        delete map[eid];
      }
      saveCfg();
      st.lastAt = Date.now();
    } catch (e) {
      st.error = String((e && e.message) || e);
      if (/no-permission/.test(st.error)) { st.granted = false; st.error = '캘린더 권한이 꺼졌어요. 다시 연동해 주세요.'; }
    } finally {
      running = false;
      dropLock();
      st.busy = false;
      if (changed) {
        commit();
        // 앱이 뒤에 있을 때도 바로 서버로 올려서 PC · 다른 기기에 곧바로 보여요
        if (document.hidden && typeof Cloud !== 'undefined' && Cloud.isActive && Cloud.isActive() && Cloud.flushNow) Cloud.flushNow().catch(() => {});
      }
      emit();
      if (again) { again = false; schedule(1500); }
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 한 번 맞추고(이미 도는 중이면 끝날 때까지 기다려서) 서버에 올려요
  const lockBusy = () => { try { const l = JSON.parse(localStorage.getItem(LOCK) || 'null'); return !!(l && l.o !== me && l.u > Date.now()); } catch (_) { return false; } };
  async function syncFully() {
    const until = Date.now() + 20000;
    while (lockBusy() && Date.now() < until - 8000) await wait(250); // 다른 화면이 맞추는 중이면 잠깐 기다려요
    await sync();
    while ((running || again) && Date.now() < until) { await wait(150); if (!running && again) { again = false; clearTimeout(schedT); await sync(); } }
    if (typeof Cloud !== 'undefined' && Cloud.isActive && Cloud.isActive() && Cloud.flushNow) { try { await Cloud.flushNow(10000); } catch (_) { /* 다음에 */ } }
  }
  async function syncAndReport() {
    try { await syncFully(); } finally { call('syncDone').catch(() => {}); }
  }
  // 앱이 닫혀 있어도 폰 캘린더가 바뀌면 깨워 달라고 폰에 알려요 (예전 APK 에는 없어서 그냥 넘어가요)
  const bgEnable = (on) => { try { const r = call('bgEnable', { on: !!on }); if (r && r.catch) r.catch(() => {}); } catch (_) { /* 예전 APK */ } };
  // 숨은 동기화 화면(앱이 닫혀 있을 때)에서 한 번만 맞추기
  async function runOnce() {
    if (!available) return { skipped: 'unavailable' };
    await checkPerm();
    cfg = loadCfg();
    if (!cfg.on || !st.granted) return { skipped: 'off' };
    await loadCalendars();
    await syncFully();
    halted = true;
    clearTimeout(schedT);
    return { ok: !st.error, error: st.error || null, counts: st.counts || null };
  }
  function schedule(ms = 3000) {
    if (!available || !cfg.on) return;
    clearTimeout(schedT);
    schedT = setTimeout(sync, ms);
  }
  function startLoop() {
    clearInterval(pollT);
    if (!cfg.on) return;
    pollT = setInterval(() => { if (!document.hidden) sync(); }, POLL_MS);
  }

  async function start() {
    if (!available || started) return;
    started = true;
    try {
      const p = C.Plugins && C.Plugins.HaruCalendar;
      // 앱이 뒤에 있으면 타이머가 늦게 돌아서, 알림이 오면 바로 맞추고 → 서버에 올린 뒤 → 폰에 "끝났어요" (폰이 그때까지 앱을 깨워 둬요)
      const onChanged = () => { clearTimeout(schedT); syncAndReport(); };
      if (p && p.addListener) p.addListener('changed', onChanged);
      else if (C.addListener) C.addListener('HaruCalendar', 'changed', onChanged);
    } catch (_) { /* 켜져 있을 때만 30초마다 맞춰요 */ }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
    await checkPerm();
    if (cfg.on && st.granted) { loadCalendars(); startLoop(); schedule(500); bgEnable(true); }
    emit();
  }
  // 설정 바꾸기: 다른 화면이 고친 연결 정보를 먼저 가져온 뒤에 고쳐요
  function edit(fn) { cfg = loadCfg(); fn(cfg); saveCfg(); emit(); }

  // 연동하기: 권한 묻기 → 캘린더 목록 → 구글이 아닌 쓰기 가능한 캘린더를 기본으로 골라요
  async function enable() {
    st.error = null;
    const r = await call('requestPermission');
    st.granted = !!(r && r.granted);
    if (!st.granted) { st.error = '캘린더 접근을 허용해야 연동할 수 있어요'; emit(); return false; }
    const cals = await loadCalendars();
    cfg = loadCfg();
    if (!cfg.calIds || !cfg.calIds.length || cfg.v !== 2) applyDefaults(cals);
    else if (!cfg.target) cfg.target = pickTarget(cals);
    cfg.v = 2;
    if (!cfg.listId) cfg.listId = 'inbox';
    cfg.on = true;
    saveCfg();
    startLoop();
    emit();
    bgEnable(true);
    await sync();
    return true;
  }
  function disable() {
    edit((c) => { c.on = false; });
    clearInterval(pollT);
    bgEnable(false);
  }
  function setCals(ids) { edit((c) => { c.calIds = ids; }); schedule(200); }
  function setTarget(id) { edit((c) => { c.target = id; if (!(c.calIds || []).includes(id)) c.calIds = [...(c.calIds || []), id]; }); schedule(200); }
  function setPush(on) { edit((c) => { c.push = !!on; }); schedule(200); }
  function setList(id) { edit((c) => { c.listId = id; }); }
  function setPast(v) { edit((c) => { c.past = Object.prototype.hasOwnProperty.call(PAST_OPTS, String(v)) ? String(v) : 'all'; }); schedule(200); }

  return {
    available,
    status: () => st,
    config: () => cfg,
    serverGoogle,
    onStatus: (f) => { listeners.add(f); return () => listeners.delete(f); },
    start, enable, disable, sync, schedule, loadCalendars, setCals, setTarget, setPush, setList, setPast, runOnce,
    _fieldsOf: fieldsOf, _eventOf: eventOf, _taskFieldsOf: taskFieldsOf, // 시험용
  };
})();
