'use strict';

/* =========================================================================
 * 근무 탭 (폰) — 근무 계획 + 이 달 예상 월급. 계산은 workpay.js (PC 와 같이 써요)
 * 화면 도구(state · head · openSheet · commit …)는 mobile.js 것을 써요. (이 파일이 먼저 읽혀서, 쓰는 건 눌렀을 때만)
 * ========================================================================= */
const MWork = (() => {
  let month = todayStr().slice(0, 7);
  let sel = todayStr();
  let detailOpen = false;
  let draft = null; // 열려 있는 근무 · 근무지 시트
  const lastTimes = {};
  let lastJob = null;

  const jobs = () => state.data.jobs;
  const jobById = (id) => jobs().find((j) => j.id === id);
  const shiftsOn = (d) => state.data.shifts.filter((s) => s.date === d && jobById(s.jobId)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const money = WorkPay.moneyText;
  const hours = WorkPay.hoursText;
  const short = (t) => { const [h, m] = String(t || '').split(':').map(Number); return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`; };
  const timeText = (t) => String(t || '').replace(/^0(\d):/, '$1:');
  const moveMonth = (n) => { const d = parseYmd(`${month}-01`); d.setMonth(d.getMonth() + n); month = ymd(d).slice(0, 7); sel = month === todayStr().slice(0, 7) ? todayStr() : `${month}-01`; };
  const jobTags = (j) => [`시급 ${money(j.wage)}`, j.weekly ? '주휴' : '', j.fivePlus ? '5인 이상' : '', j.deduct === 'tax33' ? '3.3%' : j.deduct === 'ins' ? '4대보험' : ''].filter(Boolean).join(' · ');

  function view() {
    const [y, m] = month.split('-').map(Number);
    const ws = Number(S().weekStart) || 0;
    const res = WorkPay.month(jobs(), state.data.shifts, month, { weekStart: ws });
    const t = res.total;
    const first = `${month}-01`;
    const start = addDays(first, -((parseYmd(first).getDay() - ws + 7) % 7));
    const today = todayStr();
    const heads = Array.from({ length: 7 }, (_, i) => { const wd = (ws + i) % 7; return `<span class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">${WEEKDAYS[wd]}</span>`; }).join('');
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const wd = parseYmd(d).getDay();
      const list = shiftsOn(d);
      const hol = holidayOf(d);
      cells += `<button class="m-cell mw-cell${d.slice(0, 7) !== month ? ' out' : ''}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}${wd === 0 || hol ? ' sun' : wd === 6 ? ' sat' : ''}" data-mw="day" data-d="${d}">
        <span class="m-cell-n">${parseYmd(d).getDate()}</span>
        <span class="m-cell-bars">${list.slice(0, 2).map((x) => `<span class="m-bar mw-bar" style="--c:${esc(jobById(x.jobId).color)}">${short(x.start)}~${short(x.end)}</span>`).join('')}${list.length > 2 ? `<span class="m-more">+${list.length - 2}</span>` : ''}</span>
      </button>`;
      if (i === 34 && addDays(start, 35).slice(0, 7) !== month) break;
    }
    const nav = `<div class="m-cal-nav"><button data-mw="month" data-n="-1" aria-label="지난달">${icon('chevL')}</button><button class="m-pill" data-mw="month-today">이번 달</button><button data-mw="month" data-n="1" aria-label="다음 달">${icon('chevR')}</button></div>`;
    const active = res.jobs.filter((r) => r.paidMin > 0 || r.gross > 0);
    const line = (label, v, cls = '') => `<div class="mw-line ${cls}"><span>${label}</span><b>${v}</b></div>`;
    const detail = active.map((r) => {
      const j = r.job;
      const ded = Object.entries(r.ded).filter(([, v]) => v > 0);
      return `<div class="mw-job-sum"><div class="mw-js-h"><i style="--c:${esc(j.color)}"></i><span>${esc(j.name)}</span><b>${money(r.net)}</b></div>
        ${line(`기본급 <small>${hours(r.paidMin)}</small>`, money(r.base))}
        ${j.weekly ? line('주휴수당', r.weekly ? money(r.weekly) : '<small>주 15시간 이상부터</small>') : ''}
        ${j.fivePlus ? line(`야간 수당 <small>${hours(r.nightMin)}</small>`, money(r.night)) : ''}
        ${j.fivePlus ? line(`연장 수당 <small>${hours(r.otMin)}</small>`, money(r.overtime)) : ''}
        ${line('세전 합계', money(r.gross), 'sub')}
        ${ded.map(([k, v]) => line(WorkPay.DED_LABEL[k], `- ${money(v)}`, 'minus')).join('')}
        ${line('실수령 예상', money(r.net), 'net')}</div>`;
    }).join('');
    const selList = shiftsOn(sel);
    const sd = parseYmd(sel);
    return `${head(`${y}년 ${m}월 근무`, '', '', nav)}
      <div class="m-card m-pad mw-sum">
        <div class="mw-sum-h">예상 실수령</div>
        <div class="mw-sum-big">${money(t.net)}</div>
        <div class="mw-sum-sub">${t.paidMin ? `근무 ${t.days}일 · ${hours(t.paidMin)} · 세전 ${money(t.gross)}` : jobs().length ? '날짜를 고르고 + 를 눌러 근무를 넣어 보세요' : '먼저 아래에서 근무지를 추가해 주세요'}</div>
        ${active.length ? `<button class="mw-more" data-mw="detail">${detailOpen ? '접기' : '자세히 보기'}${icon('chevD', detailOpen ? 'flip' : '')}</button>${detailOpen ? detail : ''}` : ''}
      </div>
      <div class="m-cal mw-cal"><div class="m-cal-wd">${heads}</div><div class="m-cal-grid">${cells}</div></div>
      <div class="m-day">
        <div class="m-day-h"><b>${sd.getMonth() + 1}월 ${sd.getDate()}일 (${WEEKDAYS[sd.getDay()]})</b></div>
        ${selList.map((x) => { const j = jobById(x.jobId); const sp = WorkPay.span(x); return `<button class="mw-shift" data-mw="edit" data-id="${esc(x.id)}" style="--c:${esc(j.color)}">
          <span class="mw-sh-t">${timeText(x.start)} ~ ${timeText(x.end)}${sp && sp.end > 1440 ? ' <small>(다음 날)</small>' : ''}</span>
          <span class="mw-sh-m">${esc(j.name)} · ${sp ? hours(sp.paid) : ''}${x.breakMin ? ` (쉬는 시간 ${x.breakMin}분)` : ''}${x.memo ? ` · ${esc(x.memo)}` : ''}</span></button>`; }).join('') || '<p class="m-day-empty">이 날 근무가 없어요</p>'}
      </div>
      <div class="m-card-h mw-jobs-h"><span>근무지</span><button data-mw="job-add">${icon('plus')}근무지 추가</button></div>
      <div class="m-card">${jobs().map((j) => `<button class="mw-job" data-mw="job-edit" data-id="${esc(j.id)}"><i style="--c:${esc(j.color)}"></i><span><b>${esc(j.name)}</b><small>${esc(jobTags(WorkPay.normalizeJob(j)))}</small></span>${icon('chevR')}</button>`).join('') || '<p class="m-day-empty">예: 카페, 편의점처럼 일하는 곳을 추가하면 시급과 공제 방식을 정할 수 있어요</p>'}</div>
      <p class="m-foot">${WorkPay.RATES.year}년 기준 예상 금액이에요. 주휴수당은 한 주에 15시간 이상 일하면 붙고, 그 주가 끝나는 달에 넣어요. 4대보험은 근로자 몫만, 근로소득세는 빠져 있어요.</p>
      <div class="m-bottom-space"></div>`;
  }

  // ---------- 근무 시트 ----------
  function shiftHTML() {
    const x = draft.v;
    const j = jobById(x.jobId);
    const sp = WorkPay.span(x);
    const pv = j && sp && sp.paid > 0 ? `${sp.end > 1440 ? '다음 날까지 · ' : ''}<b>${hours(sp.paid)}</b> 근무 · 기본급 약 <b>${money(Math.round((sp.paid / 60) * (Number(j.wage) || 0)))}</b>` : '';
    return `<div class="mw-sheet">
      <h3>${draft.isNew ? '근무 추가' : '근무 고치기'}</h3>
      <label class="m-dp-row">${icon('lists')}<span>근무지</span><span class="flex1"></span><select id="mwJob">${jobs().map((o) => `<option value="${esc(o.id)}" ${o.id === x.jobId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <label class="m-dp-row">${icon('calendar')}<span>날짜</span><span class="flex1"></span><input type="date" id="mwDate" value="${esc(x.date)}"></label>
      <label class="m-dp-row">${icon('clock')}<span>시작</span><span class="flex1"></span><input type="time" id="mwStart" value="${esc(x.start)}"></label>
      <label class="m-dp-row">${icon('clock')}<span>끝</span><span class="flex1"></span><input type="time" id="mwEnd" value="${esc(x.end)}"></label>
      <label class="m-dp-row">${icon('sun')}<span>쉬는 시간 (분)</span><span class="flex1"></span><input type="number" id="mwBreak" inputmode="numeric" min="0" step="10" value="${Number(x.breakMin) || 0}"></label>
      <div class="mw-preview" id="mwPreview">${pv}</div>
      <input id="mwMemo" class="m-input" placeholder="메모 (예: 마감조)" value="${esc(x.memo || '')}" autocomplete="off" enterkeyhint="done">
      ${draft.isNew ? `<label class="m-dp-row">${icon('repeat')}<span>반복</span><span class="flex1"></span><select id="mwRepeat">
        <option value="0">안 함</option><option value="month">이 달 매주</option><option value="4">4주 동안 매주</option><option value="8">8주 동안 매주</option><option value="13">3달 동안 매주</option></select></label>` : ''}
      <div class="m-dp-foot">${draft.isNew ? '<button class="m-btn" data-mw="cancel">취소</button>' : `<button class="m-btn danger" data-mw="shift-del">${icon('trash')}삭제</button>`}<button class="m-btn primary" data-mw="shift-save">${draft.isNew ? '추가' : '저장'}</button></div>
    </div>`;
  }
  function readShift() {
    return {
      jobId: $('#mwJob').value, date: $('#mwDate').value, start: $('#mwStart').value, end: $('#mwEnd').value,
      breakMin: Math.max(0, Math.round(Number($('#mwBreak').value) || 0)), memo: $('#mwMemo').value.trim(),
    };
  }
  function openShift(shift, date) {
    if (!canEdit()) return;
    if (!jobs().length) { openJob(null, () => openShift(null, date)); return; }
    const jobId = shift ? shift.jobId : (lastJob && jobById(lastJob) ? lastJob : jobs()[0].id);
    const lt = lastTimes[jobId] || {};
    const v = shift ? { ...shift } : { id: uid(), jobId, date: date || sel, start: lt.start || '09:00', end: lt.end || '18:00', breakMin: lt.breakMin ?? 60, memo: '' };
    draft = { kind: 'shift', isNew: !shift, v };
    openSheet(shiftHTML(), { cls: 'mwsheet' });
  }
  function saveShift() {
    const v = readShift();
    if (!jobById(v.jobId)) { toast('근무지를 골라 주세요'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) { toast('날짜를 골라 주세요'); return; }
    const sp = WorkPay.span(v);
    if (!sp) { toast('시작 · 끝 시간을 넣어 주세요'); return; }
    if (sp.raw === 1440) { toast('시작과 끝 시간이 같아요'); return; }
    if (sp.paid <= 0) { toast('쉬는 시간이 근무 시간보다 길어요'); return; }
    lastTimes[v.jobId] = { start: v.start, end: v.end, breakMin: v.breakMin };
    lastJob = v.jobId;
    if (draft.isNew) {
      const repeat = $('#mwRepeat').value;
      const dates = [v.date];
      if (repeat !== '0') {
        const until = repeat === 'month' ? `${v.date.slice(0, 7)}-31` : addDays(v.date, Number(repeat) * 7 - 1);
        for (let d = addDays(v.date, 7); d <= until; d = addDays(d, 7)) {
          if (repeat === 'month' && d.slice(0, 7) !== v.date.slice(0, 7)) break;
          dates.push(d);
        }
      }
      for (const d of dates) state.data.shifts.push({ ...v, id: d === v.date ? draft.v.id : uid(), date: d });
      sel = v.date;
      closeSheet({ silent: true });
      draft = null;
      commit();
      toast(dates.length > 1 ? `근무 ${dates.length}개를 넣었어요` : '근무를 넣었어요');
    } else {
      const cur = state.data.shifts.find((s) => s.id === draft.v.id);
      if (cur) Object.assign(cur, v);
      closeSheet({ silent: true });
      draft = null;
      commit();
    }
  }

  // ---------- 근무지 시트 ----------
  function jobHTML() {
    const j = draft.v;
    const ins = (k, label) => `<label class="mw-check"><input type="checkbox" id="mwjIns_${k}" ${j.ins[k] ? 'checked' : ''}><span>${label}</span></label>`;
    return `<div class="mw-sheet">
      <h3>${draft.isNew ? '근무지 추가' : '근무지 고치기'}</h3>
      <input id="mwjName" class="m-input" placeholder="이름 (예: 카페, 편의점)" value="${esc(j.name)}" autocomplete="off" enterkeyhint="done">
      <div class="m-swatches mw-colors">${PRESET_COLORS.map((c) => `<button class="m-sw ${c === j.color ? 'on' : ''}" style="--c:${c}" data-mw="job-color" data-c="${c}"></button>`).join('')}</div>
      <label class="m-dp-row">${icon('clock')}<span>시급 (원)</span><span class="flex1"></span><input type="number" id="mwjWage" inputmode="numeric" min="0" step="10" value="${j.wage}"></label>
      <p class="mw-hint">${WorkPay.RATES.year}년 최저시급은 ${money(WorkPay.RATES.minWage)}이에요</p>
      <label class="mw-check"><input type="checkbox" id="mwjWeekly" ${j.weekly ? 'checked' : ''}><span>주휴수당 받기<small>한 주에 15시간 이상 일하면 붙어요</small></span></label>
      <label class="mw-check"><input type="checkbox" id="mwjFive" ${j.fivePlus ? 'checked' : ''}><span>5인 이상 사업장<small>밤 10시~아침 6시, 하루 8시간 · 주 40시간이 넘는 시간은 50% 더 받아요</small></span></label>
      <div class="mw-ded"><span>월급에서 떼는 돈</span><div class="m-seg">${[['none', '없음'], ['tax33', '3.3%'], ['ins', '4대보험']].map(([v, l]) => `<button class="${j.deduct === v ? 'on' : ''}" data-mw="job-deduct" data-v="${v}">${l}</button>`).join('')}</div></div>
      ${j.deduct === 'ins' ? `<div class="mw-ins">${ins('pension', '국민연금 4.75%')}${ins('health', '건강보험 3.595% (+ 장기요양)')}${ins('employ', '고용보험 0.9%')}</div>` : ''}
      <div class="m-dp-foot">${draft.isNew ? '<button class="m-btn" data-mw="cancel">취소</button>' : `<button class="m-btn danger" data-mw="job-del">${icon('trash')}삭제</button>`}<button class="m-btn primary" data-mw="job-save">${draft.isNew ? '추가' : '저장'}</button></div>
    </div>`;
  }
  // 시트를 다시 그리기 전에 지금 적은 값을 기억해요
  function keepJob() {
    const j = draft.v;
    j.name = $('#mwjName').value;
    j.wage = $('#mwjWage').value;
    j.weekly = $('#mwjWeekly').checked;
    j.fivePlus = $('#mwjFive').checked;
    for (const k of ['pension', 'health', 'employ']) { const el = $(`#mwjIns_${k}`); if (el) j.ins[k] = el.checked; }
  }
  function openJob(job, after) {
    if (!canEdit()) return;
    const v = WorkPay.normalizeJob(job || { id: uid(), name: '', color: PRESET_COLORS[(jobs().length + 5) % PRESET_COLORS.length], wage: WorkPay.RATES.minWage, weekly: true, fivePlus: false, deduct: 'none' });
    draft = { kind: 'job', isNew: !job, v, after };
    openSheet(jobHTML(), { cls: 'mwsheet', onMount: (el) => { if (!job) setTimeout(() => $('#mwjName', el).focus(), 60); } });
  }
  function saveJob() {
    keepJob();
    const j = draft.v;
    const name = String(j.name || '').trim();
    if (!name) { toast('근무지 이름을 적어 주세요'); $('#mwjName').focus(); return; }
    const wage = Math.round(Number(j.wage) || 0);
    if (wage <= 0) { toast('시급을 적어 주세요'); return; }
    const v = { id: j.id, name, color: j.color, wage, weekly: !!j.weekly, fivePlus: !!j.fivePlus, deduct: j.deduct, ins: { ...j.ins } };
    const cur = jobById(j.id);
    if (cur) Object.assign(cur, v); else state.data.jobs.push(v);
    const after = draft.after;
    closeSheet({ silent: true });
    draft = null;
    commit();
    if (wage < WorkPay.RATES.minWage) toast(`최저시급(${money(WorkPay.RATES.minWage)})보다 낮아요. 그대로 저장했어요`, { timeout: 5000 });
    if (after) setTimeout(after, 300);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mw]');
    if (!el || !state.data) return;
    const a = el.dataset.mw;
    switch (a) {
      case 'month': moveMonth(Number(el.dataset.n)); render(); break;
      case 'month-today': month = todayStr().slice(0, 7); sel = todayStr(); render(); break;
      case 'day':
        if (sel === el.dataset.d && shiftsOn(sel).length === 0) { openShift(null, sel); break; } // 빈 날을 한 번 더 누르면 바로 추가
        sel = el.dataset.d;
        if (sel.slice(0, 7) !== month) month = sel.slice(0, 7);
        render();
        break;
      case 'detail': detailOpen = !detailOpen; render(); break;
      case 'edit': { const x = state.data.shifts.find((s) => s.id === el.dataset.id); if (x) openShift(x); break; }
      case 'cancel': closeSheet({ silent: true }); draft = null; break;
      case 'shift-save': saveShift(); break;
      case 'shift-del': {
        const id = draft && draft.v.id;
        closeSheet({ silent: true });
        draft = null;
        withUndo('근무를 지웠어요', () => { state.data.shifts = state.data.shifts.filter((s) => s.id !== id); });
        break;
      }
      case 'job-add': openJob(null); break;
      case 'job-edit': openJob(jobById(el.dataset.id)); break;
      case 'job-color': keepJob(); draft.v.color = el.dataset.c; rerenderSheet(topSheet(), jobHTML()); break;
      case 'job-deduct': keepJob(); draft.v.deduct = el.dataset.v; rerenderSheet(topSheet(), jobHTML()); break;
      case 'job-save': saveJob(); break;
      case 'job-del': {
        const j = jobById(draft && draft.v.id);
        if (!j) break;
        const n = state.data.shifts.filter((s) => s.jobId === j.id).length;
        askConfirm(`"${j.name}" 근무지${n ? `와 근무 ${n}개` : ''}를 지울까요?`, { okText: '지우기', danger: true }).then((ok) => {
          if (!ok) return;
          closeSheet({ silent: true });
          draft = null;
          withUndo(`"${j.name}" 근무지를 지웠어요`, () => {
            state.data.jobs = state.data.jobs.filter((x) => x.id !== j.id);
            state.data.shifts = state.data.shifts.filter((s) => s.jobId !== j.id);
          });
        });
        break;
      }
      default: break;
    }
  });
  // 시간 · 쉬는 시간을 바꾸면 미리 보기를 바로 고쳐요
  document.addEventListener('input', (e) => {
    if (!draft || draft.kind !== 'shift' || !e.target.closest || !e.target.closest('.mw-sheet')) return;
    const v = readShift();
    Object.assign(draft.v, v);
    const pv = $('#mwPreview');
    const j = jobById(v.jobId);
    const sp = WorkPay.span(v);
    if (pv) pv.innerHTML = j && sp && sp.paid > 0 ? `${sp.end > 1440 ? '다음 날까지 · ' : ''}<b>${hours(sp.paid)}</b> 근무 · 기본급 약 <b>${money(Math.round((sp.paid / 60) * (Number(j.wage) || 0)))}</b>` : '';
  });
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'mwJob' || !draft || !draft.isNew) return;
    const lt = lastTimes[e.target.value];
    if (lt) { $('#mwStart').value = lt.start; $('#mwEnd').value = lt.end; $('#mwBreak').value = lt.breakMin; }
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
  });

  return { view, add: () => openShift(null, sel) };
})();
