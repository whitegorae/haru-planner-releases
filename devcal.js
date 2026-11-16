'use strict';

/* =========================================================================
 * 폰 캘린더(삼성 캘린더 등) ↔ 하루플래너 — 안드로이드 앱(1.3.0~)에서만
 *  - 고른 폰 캘린더의 일정 ↔ 날짜가 있는 할 일 (지난 30일 ~ 앞으로 1년)
 *  - 앱이 켜져 있는 동안: 폰 캘린더가 바뀌면 바로, 그 밖에도 30초마다 맞춰요
 *  - 하루플래너에서 바꾼 건 몇 초 안에 폰 캘린더로 (다른 기기에서 바꾼 것도 실시간으로 받아서 보내요)
 *  - 연결 정보(폰 일정 id ↔ 할 일 id)는 이 폰에만 저장해요
 *  - 구글 계정 캘린더는 고르지 않아요 → 구글은 서버 연동(CalSync)이 맡아요 (두 번 생기지 않게)
 *  - 반복 일정은 건너뛰어요. 끝낸 할 일은 폰 캘린더에 "✓ 제목" 으로 보여요.
 * 이 파일은 mobile.js 의 state · taskById · makeTask · commit · taskEnd 를 실행 중에 써요.
 * ========================================================================= */

const DevCal = (() => {
  const C = window.Capacitor;
  const available = !!(C && ((C.isPluginAvailable && C.isPluginAvailable('HaruCalendar')) || (Array.isArray(C.PluginHeaders) && C.PluginHeaders.some((h) => h.name === 'HaruCalendar'))));
  const call = (m, o = {}) => {
    const p = C.Plugins && C.Plugins.HaruCalendar;
    if (p && typeof p[m] === 'function') return p[m](o);
    return C.nativePromise('HaruCalendar', m, o);
  };
  const KEY = 'haru-devcal';
  const PAST = 30;
  const FUTURE = 365;
  const POLL_MS = 30 * 1000;
  const DONE = '✓ ';
  let cfg = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } })();
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) { /* 무시 */ } };
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
    try { st.calendars = ((await call('calendars')).calendars || []).map((c) => ({ ...c, google: /google/i.test(c.accountType || '') })); } catch (e) { st.error = e.message; }
    emit();
    return st.calendars || [];
  }

  async function sync() {
    if (!available || !cfg.on || !st.granted || !state.data) return;
    if (typeof canEdit === 'function' && state.offline) return;
    if (running) { again = true; return; }
    running = true;
    st.busy = true;
    st.error = null;
    emit();
    let changed = false;
    try {
      cfg.map = cfg.map || {};
      const map = cfg.map;
      const ids = [...new Set([...(cfg.calIds || []), cfg.target].filter(Boolean))];
      const today = todayStr();
      const minDate = addDays(today, -PAST);
      const { events = [] } = await call('events', { calIds: ids, from: localMs(minDate, null), to: localMs(addDays(today, FUTURE), null) });
      const seen = new Set();

      // 1) 폰 캘린더 → 하루플래너
      for (const ev of events) {
        if (ev.rrule) continue; // 반복 일정은 건너뛰어요
        seen.add(ev.id);
        const fp = fpOf(ev);
        const m = map[ev.id];
        let t = m ? taskById(m.tid) : null;
        if (m && m.fp === fp) continue; // 그대로
        if (!t && m) continue; // 하루플래너에서 지운 할 일 → 3) 에서 폰에서도 지워요
        const f = fieldsOf(ev, m);
        if (!m) { // 처음 보는 폰 일정: 제목 · 날짜 · 시각이 같은 할 일이 아직 연결 안 돼 있으면 새로 만들지 않고 이어 붙여요
          const key = `${f.title.trim().toLowerCase()}|${f.dueDate}|${f.dueTime || ''}`;
          const linkedTids = new Set(Object.values(map).map((x) => x.tid));
          const same = state.data.tasks.find((x) => !linkedTids.has(x.id) && x.dueDate && `${String(x.title || '').trim().toLowerCase()}|${x.dueDate}|${x.dueTime || ''}` === key);
          if (same) { map[ev.id] = { tid: same.id, fp, h: hashOf({ ...same, ...f }), noEnd: false }; continue; }
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
        map[ev.id] = { tid: t.id, fp, h: hashOf(t), noEnd: !!(m && m.noEnd && !t.endTime && t.dueTime) };
        changed = true;
      }
      // 폰에서 지운 일정 (안 보이는 것만 따로 확인해요: 기간 밖으로 옮긴 건 지우지 않아요)
      const missing = Object.keys(map).filter((id) => !seen.has(id));
      if (missing.length) {
        const { events: alive = [] } = await call('existing', { ids: missing });
        const still = new Set(alive.map((e) => e.id));
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

      // 2) 하루플래너 → 폰 캘린더
      if (cfg.push !== false && cfg.target) {
        const evOf = new Map(Object.entries(map).map(([eid, m]) => [m.tid, eid]));
        for (const t of state.data.tasks) {
          const eid = evOf.get(t.id);
          const m = eid ? map[eid] : null;
          if (!t.dueDate) { if (m) { await call('remove', { id: eid }).catch(() => {}); delete map[eid]; } continue; }
          if (!m && taskEnd(t) < minDate) continue;
          const h = hashOf(t);
          if (m && m.h === h) continue;
          const e = eventOf(t);
          const r = await call('upsert', { id: eid || null, calId: cfg.target, title: e.title, notes: e.notes, start: e.start, end: e.end, allDay: e.allDay });
          if (eid && r.id !== eid) delete map[eid];
          map[r.id] = { tid: t.id, fp: fpOf(e), h, noEnd: e.noEnd };
        }
      }
      // 3) 하루플래너에서 지운 할 일 → 폰에서도 지우기
      for (const [eid, m] of Object.entries(map)) {
        if (taskById(m.tid)) continue;
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
      st.busy = false;
      if (changed) commit();
      emit();
      if (again) { again = false; schedule(1500); }
    }
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
      if (p && p.addListener) p.addListener('changed', () => schedule(500));
      else if (C.addListener) C.addListener('HaruCalendar', 'changed', () => schedule(500));
    } catch (_) { /* 켜져 있을 때만 30초마다 맞춰요 */ }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
    await checkPerm();
    if (cfg.on && st.granted) { loadCalendars(); startLoop(); schedule(500); }
    emit();
  }

  // 연동하기: 권한 묻기 → 캘린더 목록 → 구글이 아닌 쓰기 가능한 캘린더를 기본으로 골라요
  async function enable() {
    st.error = null;
    const r = await call('requestPermission');
    st.granted = !!(r && r.granted);
    if (!st.granted) { st.error = '캘린더 접근을 허용해야 연동할 수 있어요'; emit(); return false; }
    const cals = await loadCalendars();
    const mine = cals.filter((c) => !c.google && c.visible !== false);
    const writable = mine.filter((c) => c.writable);
    if (!cfg.calIds || !cfg.calIds.length) cfg.calIds = mine.map((c) => c.id);
    if (!cfg.target || !writable.some((c) => c.id === cfg.target)) {
      const pick = writable.find((c) => /samsung|osp/i.test(c.accountType || '')) || writable.find((c) => /local/i.test(c.accountType || '')) || writable[0];
      cfg.target = pick ? pick.id : null;
    }
    if (!cfg.listId) cfg.listId = 'inbox';
    cfg.on = true;
    saveCfg();
    startLoop();
    emit();
    await sync();
    return true;
  }
  function disable() {
    cfg.on = false;
    clearInterval(pollT);
    saveCfg();
    emit();
  }
  function setCals(ids) { cfg.calIds = ids; saveCfg(); emit(); schedule(200); }
  function setTarget(id) { cfg.target = id; if (!(cfg.calIds || []).includes(id)) cfg.calIds = [...(cfg.calIds || []), id]; saveCfg(); emit(); schedule(200); }
  function setPush(on) { cfg.push = !!on; saveCfg(); emit(); schedule(200); }
  function setList(id) { cfg.listId = id; saveCfg(); emit(); }

  return {
    available,
    status: () => st,
    config: () => cfg,
    onStatus: (f) => { listeners.add(f); return () => listeners.delete(f); },
    start, enable, disable, sync, schedule, loadCalendars, setCals, setTarget, setPush, setList,
    _fieldsOf: fieldsOf, _eventOf: eventOf, // 시험용
  };
})();
