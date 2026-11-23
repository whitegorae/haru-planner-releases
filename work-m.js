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

  // ---------- 자주 쓰는 시간 (근무지마다 job.presets · PC 와 같이 써요) ----------
  const presetsOf = (j) => (j && Array.isArray(j.presets) ? j.presets : []);
  const allPresets = () => jobs().flatMap((j) => presetsOf(j).map((p) => ({ ...p, job: j, key: `${j.id}:${p.id}` })));
  const presetByKey = (k) => allPresets().find((p) => p.key === k) || null;
  const rangeText = (p) => `${timeText(p.start)}~${timeText(p.end)}`;
  const preChip = (p, a) => `<button class="mw-pre" data-mw="${a}" data-k="${esc(p.key)}" style="--c:${esc(p.job.color)}"><b>${esc(p.name)}</b>${p.name !== rangeText(p) ? `<span>${rangeText(p)}</span>` : ''}${jobs().length > 1 ? `<small>${esc(p.job.name)}</small>` : ''}</button>`;
  function repeatDates(date, repeat) {
    const dates = [date];
    if (!repeat || repeat === '0') return dates;
    const until = repeat === 'month' ? `${date.slice(0, 7)}-31` : addDays(date, Number(repeat) * 7 - 1);
    for (let d = addDays(date, 7); d <= until; d = addDays(d, 7)) {
      if (repeat === 'month' && d.slice(0, 7) !== date.slice(0, 7)) break;
      dates.push(d);
    }
    return dates;
  }
  function addFromPreset(p, dates) {
    if (!canEdit()) return;
    const memo = p.name && p.name !== rangeText(p) ? p.name : '';
    const md = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`;
    withUndo(dates.length > 1 ? `"${p.name}" 근무 ${dates.length}개를 넣었어요` : `${md(dates[0])}에 "${p.name}" 근무를 넣었어요`, () => {
      for (const d of dates) state.data.shifts.push({ id: uid(), jobId: p.job.id, date: d, start: p.start, end: p.end, breakMin: Number(p.breakMin) || 0, memo });
    });
    lastJob = p.job.id;
    lastTimes[p.job.id] = { start: p.start, end: p.end, breakMin: Number(p.breakMin) || 0 };
  }
  function savePreset(jobId, v, name) {
    const j = jobById(jobId);
    if (!j) return false;
    const list = presetsOf(j);
    if (list.some((p) => p.start === v.start && p.end === v.end && (Number(p.breakMin) || 0) === (Number(v.breakMin) || 0))) { toast('같은 시간이 이미 저장돼 있어요'); return false; }
    j.presets = [...list, { id: uid(), name: String(name || '').trim() || rangeText(v), start: v.start, end: v.end, breakMin: Number(v.breakMin) || 0 }];
    commit();
    toast(`"${j.presets[j.presets.length - 1].name}"을(를) 자주 쓰는 시간에 저장했어요`);
    return true;
  }

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
        ${allPresets().length ? `<div class="mw-pre-row"><span class="mw-pre-l">자주 쓰는 시간 · 누르면 이 날에 바로 넣어요</span><div class="mw-pre-chips">${allPresets().map((p) => preChip(p, 'pre-quick')).join('')}</div></div>` : ''}
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
      ${draft.isNew && allPresets().length ? `<div class="mw-pre-row in-sheet"><span class="mw-pre-l">자주 쓰는 시간 · 누르면 바로 넣어요</span><div class="mw-pre-chips">${allPresets().map((p) => preChip(p, 'pre-add')).join('')}</div></div>` : ''}
      <label class="m-dp-row">${icon('lists')}<span>근무지</span><span class="flex1"></span><select id="mwJob">${jobs().map((o) => `<option value="${esc(o.id)}" ${o.id === x.jobId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <button class="m-dp-row mw-when-row" data-mw="when" data-open="">${icon('calendar')}<span>날짜${draft.isNew ? ' · 반복' : ''}</span><span class="flex1"></span><span class="mw-when">${esc(dateText(x, draft.isNew))}</span>${icon('chevR')}</button>
      <button class="m-dp-row mw-when-row" data-mw="when" data-open="st">${icon('clock')}<span>출근</span><span class="flex1"></span><span class="mw-when">${esc(timeLabel(x.start))}</span>${icon('chevR')}</button>
      <button class="m-dp-row mw-when-row" data-mw="when" data-open="et">${icon('clock')}<span>퇴근</span><span class="flex1"></span><span class="mw-when">${esc(endLabel(x))}</span>${icon('chevR')}</button>
      <label class="m-dp-row">${icon('sun')}<span>쉬는 시간 (분)</span><span class="flex1"></span><input type="number" id="mwBreak" inputmode="numeric" min="0" step="10" value="${Number(x.breakMin) || 0}"></label>
      <div class="mw-pv-row"><div class="mw-preview" id="mwPreview">${pv}</div><button class="mw-pre-save" data-mw="pre-save">${icon('plus')}자주 쓰는 시간으로 저장</button></div>
      <input id="mwMemo" class="m-input" placeholder="메모 (예: 마감조)" value="${esc(x.memo || '')}" autocomplete="off" enterkeyhint="done">
      <div class="m-dp-foot">${draft.isNew ? '<button class="m-btn" data-mw="cancel">취소</button>' : `<button class="m-btn danger" data-mw="shift-del">${icon('trash')}삭제</button>`}<button class="m-btn primary" data-mw="shift-save">${draft.isNew ? '추가' : '저장'}</button></div>
    </div>`;
  }
  function readShift() {
    const w = (draft && draft.v) || {};
    return {
      jobId: $('#mwJob').value, date: w.date, start: w.start, end: w.end,
      breakMin: Math.max(0, Math.round(Number($('#mwBreak').value) || 0)), memo: $('#mwMemo').value.trim(),
    };
  }

  // ---------- 날짜 · 시간 고르기 시트 (PC 의 "날짜 / 지속 시간" 창과 같은 구성) ----------
  // 출근 · 퇴근은 따로따로 골라요 (하나를 바꿔도 다른 하나는 그대로). 목록은 15분 단위, 분 단위는 "직접 입력"으로
  const REPEAT_OPTS = [{ v: '0', label: '안 함' }, { v: 'month', label: '이 달 끝날 때까지 매주' }, { v: '4', label: '4주 동안 매주' }, { v: '8', label: '8주 동안 매주' }, { v: '13', label: '3달 동안 매주' }];
  const durMin = (x) => { const d = (hm(x.end) - hm(x.start) + 1440) % 1440; return d || 1440; };
  const durText = (m) => (m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`);
  const nextDay = (x) => hm(x.end) <= hm(x.start);
  const endLabel = (x) => `${nextDay(x) ? '다음 날 ' : ''}${timeLabel(x.end)}`;
  const rangeLabel = (x) => `${timeLabel(x.start)} – ${endLabel(x)}`;
  const repeatLabel = (r) => (REPEAT_OPTS.find((o) => o.v === String(r || '0')) || REPEAT_OPTS[0]).label;
  function dateText(x, withRepeat) {
    const d = parseYmd(x.date);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})${withRepeat && x.repeat && x.repeat !== '0' ? ` · ${repeatLabel(x.repeat)}` : ''}`;
  }
  // "17:20", "1720", "17시 20분", "오후 5:20", "5시" 같은 글자를 HH:MM 으로
  function parseTime(s) {
    const t = String(s || '').trim();
    if (!t) return null;
    const pm = /오후|pm/i.test(t);
    const am = /오전|am/i.test(t);
    const n = t.match(/\d+/g);
    if (!n) return null;
    let h;
    let m;
    if (n.length === 1 && n[0].length >= 3) { h = Number(n[0].slice(0, -2)); m = Number(n[0].slice(-2)); } else { h = Number(n[0]); m = n.length > 1 ? Number(n[1]) : 0; }
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h === 24 && m === 0) h = 0;
    if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
    return hmStr(h * 60 + m);
  }
  let tp = null; // { v, tab, open, month, opts }
  function tpTimes(k, cur, after = null) {
    const from = after === null ? 0 : after + 15;
    const to = after === null ? 1440 : after + 1440;
    const mins = [];
    for (let m = from; m < to; m += 15) mins.push(m);
    if (cur) { // 15분 단위가 아닌 시각도 제자리에 보여줘요
      let c = hm(cur);
      if (after !== null && c <= after) c += 1440;
      if (!mins.includes(c)) { mins.push(c); mins.sort((a, b) => a - b); }
    }
    const items = mins.map((m) => {
      const v = hmStr(m % 1440);
      const extra = after === null ? '' : ` <small>(${durText(m - after)}${m >= 1440 ? ' · 다음 날' : ''})</small>`;
      return `<button class="mw-time ${cur === v ? 'on' : ''}" data-mw="tp-set" data-k="${k}" data-v="${v}">${timeLabel(v)}${extra}</button>`;
    });
    return `<div class="mw-tin"><input class="m-input" data-mw-tin="${k}" placeholder="직접 입력 (예: ${k === 'end' ? '17:20' : '9:10'})" autocomplete="off" inputmode="numeric" enterkeyhint="done"><button class="m-btn" data-mw="tp-tin" data-k="${k}">적용</button></div>
      <div class="mw-times">${items.join('')}</div>`;
  }
  function tpCal() {
    const x = tp.v;
    const t = todayStr();
    const [y, m] = tp.month.split('-').map(Number);
    const ws = S().weekStart || 0;
    const lead = (new Date(y, m - 1, 1).getDay() - ws + 7) % 7;
    const start = addDays(`${tp.month}-01`, -lead);
    const heads = Array.from({ length: 7 }, (_, i) => { const wd = (ws + i) % 7; return `<span class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">${WEEKDAYS[wd]}</span>`; }).join('');
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      cells += `<button class="m-dp-d${d.slice(0, 7) !== tp.month ? ' out' : ''}${d === t ? ' today' : ''}${d === x.date ? ' on' : ''}${holidayOf(d) || parseYmd(d).getDay() === 0 ? ' sun' : ''}" data-mw="tp-pick" data-d="${d}">${parseYmd(d).getDate()}</button>`;
    }
    return `<div class="m-dp-mh"><b>${y}년 ${m}월</b><span class="flex1"></span><button data-mw="tp-month" data-dir="-1">${icon('chevL')}</button><button data-mw="tp-month" data-dir="0" class="m-pill sm">오늘</button><button data-mw="tp-month" data-dir="1">${icon('chevR')}</button></div>
      <div class="m-dp-wd">${heads}</div><div class="m-dp-grid">${cells}</div>`;
  }
  function tpHTML() {
    const x = tp.v;
    const o = tp.opts;
    const row = (k, ic, label, value, body) => `<button class="m-dp-row mw-tp-row ${tp.open === k ? 'open' : ''}" data-mw="tp-open" data-k="${k}">${icon(ic)}<span>${label}</span><span class="flex1"></span><span class="mw-when">${esc(value)}</span>${icon(tp.open === k ? 'chevD' : 'chevR')}</button>${tp.open === k ? body() : ''}`;
    const box = (k, text) => `<button class="mw-box ${tp.open === k ? 'on' : ''}" data-mw="tp-open" data-k="${k}">${esc(text)}</button>`;
    const sum = `<div class="mw-dur-row"><span>근무</span><b>${durText(durMin(x))}${nextDay(x) ? ' · 자정을 넘겨요' : ''}</b></div>`;
    const dur = (withDate) => `<div class="mw-dur">
        ${withDate ? `<div class="mw-dur-row"><span>날짜</span>${box('sd', `${Number(x.date.slice(5, 7))}월 ${Number(x.date.slice(8))}일`)}</div>${tp.open === 'sd' ? tpCal() : ''}` : ''}
        <div class="mw-dur-row"><span>출근</span>${box('st', timeLabel(x.start))}</div>
        ${tp.open === 'st' ? tpTimes('start', x.start) : ''}
        <div class="mw-dur-row"><span>퇴근</span>${box('et', endLabel(x))}</div>
        ${tp.open === 'et' ? tpTimes('end', x.end, hm(x.start)) : ''}
        ${sum}
      </div>`;
    const tail = `${o.withRepeat ? `<div class="m-dp-rows">${row('repeat', 'repeat', '반복', x.repeat && x.repeat !== '0' ? repeatLabel(x.repeat) : '', () => `<div class="mw-times">${REPEAT_OPTS.map((r) => `<button class="mw-time ${String(x.repeat || '0') === r.v ? 'on' : ''}" data-mw="tp-set" data-k="repeat" data-v="${r.v}">${r.label}</button>`).join('')}</div>`)}</div>` : ''}
      <div class="m-dp-foot"><button class="m-btn" data-mw="tp-cancel">취소</button><button class="m-btn primary" data-mw="tp-ok">확인</button></div>`;
    if (!o.withDate) return `<div class="m-dp mw-tp">${dur(false)}${tail}</div>`;
    const tabs = `<div class="m-dp-mode"><button class="${tp.tab === 'date' ? 'on' : ''}" data-mw="tp-tab" data-v="date">날짜</button><button class="${tp.tab === 'dur' ? 'on' : ''}" data-mw="tp-tab" data-v="dur">지속 시간</button></div>`;
    if (tp.tab === 'dur') return `<div class="m-dp mw-tp">${tabs}${dur(true)}${tail}</div>`;
    const quick = [['today', 'sun', '오늘'], ['tomorrow', 'sunrise', '내일'], ['week', 'plus7', '다음 주'], ['tonight', 'moon', '오늘 밤']];
    return `<div class="m-dp mw-tp">${tabs}
      <div class="m-dp-quick">${quick.map(([k, ic, l]) => `<button data-mw="tp-quick" data-k="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
      ${tpCal()}
      <div class="m-dp-rows">
        ${row('st', 'clock', '출근', timeLabel(x.start), () => tpTimes('start', x.start))}
        ${row('et', 'clock', '퇴근', endLabel(x), () => tpTimes('end', x.end, hm(x.start)))}
        <p class="mw-tp-dur">근무 ${durText(durMin(x))}${nextDay(x) ? ' · 자정을 넘겨요' : ''}</p>
      </div>
      ${tail}</div>`;
  }
  function tpRender() {
    const sh = topSheet();
    if (!sh || !sh.el.classList.contains('mwtp')) return;
    rerenderSheet(sh, tpHTML());
    const box = sh.el.querySelector('.mw-times');
    const on = box && box.querySelector('.on');
    if (box && on) box.scrollTop = on.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2;
  }
  // opts = { withDate, withRepeat, open: null | 'st' | 'et', onDone(v) }
  function openTimePicker(v, opts) {
    tp = { v: { repeat: '0', ...v }, tab: 'date', open: opts.open || (opts.withDate ? null : 'st'), month: (v.date || todayStr()).slice(0, 7), opts };
    openSheet(tpHTML(), { cls: 'mwtp' });
    tpRender();
  }
  function tpAction(a, el) {
    if (!tp) return;
    const x = tp.v;
    const k = el.dataset.k;
    switch (a) {
      case 'tp-tab': tp.tab = el.dataset.v; tp.open = null; break;
      case 'tp-quick': {
        const t = todayStr();
        x.date = k === 'tomorrow' ? addDays(t, 1) : k === 'week' ? addDays(t, 7) : t;
        if (k === 'tonight') { const d = durMin(x); x.start = '20:00'; x.end = hmStr((20 * 60 + d) % 1440); } // 오늘 밤: 근무 길이는 그대로
        tp.month = x.date.slice(0, 7);
        break;
      }
      case 'tp-month': {
        const dir = Number(el.dataset.dir);
        if (dir === 0) tp.month = todayStr().slice(0, 7);
        else { const d = parseYmd(`${tp.month}-01`); d.setMonth(d.getMonth() + dir); tp.month = ymd(d).slice(0, 7); }
        break;
      }
      case 'tp-pick': x.date = el.dataset.d; if (x.date.slice(0, 7) !== tp.month) tp.month = x.date.slice(0, 7); if (tp.open === 'sd') tp.open = null; break;
      case 'tp-open': tp.open = tp.open === k ? null : k; if (k === 'sd') tp.month = x.date.slice(0, 7); break;
      case 'tp-set':
        if (k === 'start') x.start = el.dataset.v;
        else if (k === 'end') x.end = el.dataset.v;
        else if (k === 'repeat') x.repeat = el.dataset.v;
        tp.open = null;
        break;
      case 'tp-tin': {
        const inp = document.querySelector(`.mw-tp [data-mw-tin="${k}"]`);
        const v = parseTime(inp && inp.value);
        if (!v) { toast('시각을 "17:20"처럼 적어 주세요'); if (inp) inp.focus(); return; }
        if (k === 'start') x.start = v; else x.end = v;
        if (inp) inp.blur();
        tp.open = null;
        break;
      }
      case 'tp-cancel': tp = null; closeSheet({ silent: true }); return;
      case 'tp-ok': { const fn = tp.opts.onDone; const v = { ...x }; tp = null; closeSheet({ silent: true }); if (fn) setTimeout(() => fn(v), 0); return; }
      default: return;
    }
    tpRender();
  }
  // 시간 "직접 입력"에서 완료(Enter) = 적용
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.dataset || !e.target.dataset.mwTin) return;
    e.preventDefault();
    tpAction('tp-tin', { dataset: { k: e.target.dataset.mwTin } });
  });
  function openShift(shift, date) {
    if (!canEdit()) return;
    if (!jobs().length) { openJob(null, () => openShift(null, date)); return; }
    const jobId = shift ? shift.jobId : (lastJob && jobById(lastJob) ? lastJob : jobs()[0].id);
    const lt = lastTimes[jobId] || {};
    const v = shift ? { ...shift, repeat: '0' } : { id: uid(), jobId, date: date || sel, start: lt.start || '09:00', end: lt.end || '18:00', breakMin: lt.breakMin ?? 60, memo: '', repeat: '0' };
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
      const dates = repeatDates(v.date, draft.v.repeat || '0');
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
      ${draft.isNew ? '' : `<div class="mw-pre-edit"><span>자주 쓰는 시간</span>${presetsOf(jobById(j.id)).map((p) => `<div class="mw-pre-item"><b>${esc(p.name)}</b><span>${rangeText(p)}${p.breakMin ? ` · 쉬는 시간 ${p.breakMin}분` : ''}</span><button class="m-icbtn danger" data-mw="pre-del" data-id="${esc(p.id)}" aria-label="지우기">${icon('trash')}</button></div>`).join('') || '<p class="mw-hint">근무를 추가할 때 "자주 쓰는 시간으로 저장"을 누르면 여기에 생겨요</p>'}</div>`}
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
    if (a.startsWith('tp-')) { tpAction(a, el); return; }
    switch (a) {
      // 근무 시트의 "날짜 · 시간" → 고르기 시트
      case 'when': {
        if (!draft || draft.kind !== 'shift') break;
        Object.assign(draft.v, readShift()); // 근무지 · 쉬는 시간 · 메모 적은 것 기억
        const open = el.dataset.open || null; // '' 날짜 · 'st' 출근 · 'et' 퇴근
        openTimePicker({ date: draft.v.date, start: draft.v.start, end: draft.v.end, repeat: draft.v.repeat }, {
          withDate: !open, // 출근 · 퇴근 줄은 시간만 고르는 시트
          withRepeat: !open && draft.isNew,
          open,
          onDone: (v) => {
            if (!draft || draft.kind !== 'shift') return;
            Object.assign(draft.v, { date: v.date, start: v.start, end: v.end, repeat: v.repeat });
            const sh = topSheet();
            if (sh && sh.el.classList.contains('mwsheet')) rerenderSheet(sh, shiftHTML());
          },
        });
        break;
      }
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
      // 자주 쓰는 시간
      case 'pre-quick': { const p = presetByKey(el.dataset.k); if (p) addFromPreset(p, [sel]); break; }
      case 'pre-add': {
        const p = presetByKey(el.dataset.k);
        if (!p) break;
        const date = draft && draft.v && /^\d{4}-\d{2}-\d{2}$/.test(draft.v.date || '') ? draft.v.date : sel;
        const repeat = draft && draft.v ? draft.v.repeat || '0' : '0';
        closeSheet({ silent: true });
        draft = null;
        sel = date;
        addFromPreset(p, repeatDates(date, repeat));
        break;
      }
      case 'pre-save': {
        if (!draft || draft.kind !== 'shift') break;
        const v = readShift();
        const sp = WorkPay.span(v);
        if (!jobById(v.jobId) || !sp || sp.raw === 1440 || sp.paid <= 0) { toast('시작 · 끝 시간을 확인해 주세요'); break; }
        Object.assign(draft.v, v);
        const def = v.memo || rangeText(v);
        askPrompt('자주 쓰는 시간 이름 (예: 오픈, 마감)', def, { okText: '저장' }).then((name) => {
          if (name === null) return;
          if (savePreset(v.jobId, v, name || def) && draft && draft.kind === 'shift' && topSheet()) rerenderSheet(topSheet(), shiftHTML());
        });
        break;
      }
      case 'pre-del': {
        if (!draft || draft.kind !== 'job') break;
        const j = jobById(draft.v.id);
        if (!j) break;
        keepJob();
        const p = presetsOf(j).find((x) => x.id === el.dataset.id);
        j.presets = presetsOf(j).filter((x) => x.id !== el.dataset.id);
        commit();
        rerenderSheet(topSheet(), jobHTML());
        toast(`"${p ? p.name : ''}"을(를) 자주 쓰는 시간에서 뺐어요`);
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
    if (lt && draft.v) {
      Object.assign(draft.v, readShift(), { start: lt.start, end: lt.end, breakMin: lt.breakMin, jobId: e.target.value });
      rerenderSheet(topSheet(), shiftHTML());
      return;
    }
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
  });

  return { view, add: () => openShift(null, sel) };
})();
