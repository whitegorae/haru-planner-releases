'use strict';

/* =========================================================================
 * 근무 캘린더 · 예상 월급 계산 (PC · 맥 · 폰이 같이 써요, 화면 코드는 없어요)
 *  - 근무지(jobs): { id, name, color, wage, weekly, fivePlus, deduct: 'none'|'tax33'|'ins', ins: { pension, health, employ } }
 *  - 근무(shifts): { id, jobId, date 'YYYY-MM-DD', start 'HH:MM', end 'HH:MM', breakMin, memo }
 * 2026년 기준 (바뀌면 RATES 만 고치면 돼요)
 *  - 최저시급 10,320원
 *  - 주휴수당: 한 주(7일)에 15시간 이상 일하면 (주 근무시간 ÷ 40) × 8시간 × 시급 (40시간 넘으면 8시간)
 *    → 그 주가 끝나는 날이 있는 달에 넣어요
 *  - 5인 이상 사업장: 밤 10시~아침 6시는 50% 더 (야간), 하루 8시간 · 주 40시간 넘는 시간도 50% 더 (연장)
 *  - 3.3%: 소득세 3% + 지방소득세 (소득세의 10%)
 *  - 4대보험 근로자 부담: 국민연금 4.75% · 건강보험 3.595% · 장기요양 = 건강보험료의 13.14% · 고용보험 0.9%
 *    (근로소득세는 넣지 않았어요: 간이세액표라 월급 · 가족 수마다 달라요)
 * ========================================================================= */
const WorkPay = (() => {
  const RATES = {
    year: 2026,
    minWage: 10320,
    weeklyMinHours: 15,
    incomeTax: 0.03, // 3.3% 중 소득세
    localTax: 0.1, // 소득세의 10% (지방소득세)
    pension: 0.0475,
    health: 0.03595,
    care: 0.1314, // 건강보험료의 13.14%
    employ: 0.009,
  };
  const DAY = 1440;
  // 밤 10시~아침 6시 (자정을 넘는 근무도 계산하려고 이틀 치 구간)
  const NIGHT = [[0, 360], [1320, 1800], [2760, 3240]];

  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return h > 24 || mm > 59 ? null : h * 60 + mm;
  };
  const floor10 = (x) => Math.floor(x / 10) * 10; // 보험료 · 세금은 10원 아래를 버려요
  const won = (x) => Math.round(x);

  // 'YYYY-MM-DD' ↔ 날짜 번호 (UTC 로 계산해서 시간대와 상관없어요)
  const dayNum = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
  const numDay = (n) => { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
  const weekday = (n) => new Date(n * 86400000).getUTCDay();

  function normalizeJob(j) {
    const ins = (j && j.ins) || {};
    return {
      id: j.id,
      name: String(j.name || '근무지'),
      color: j.color || '#7fb8ff',
      wage: Math.max(0, Number(j.wage) || 0),
      weekly: j.weekly !== false,
      fivePlus: !!j.fivePlus,
      deduct: ['none', 'tax33', 'ins'].includes(j.deduct) ? j.deduct : 'none',
      ins: { pension: ins.pension !== false, health: ins.health !== false, employ: ins.employ !== false },
    };
  }

  // 한 번의 근무: 몇 분 일했는지 (쉬는 시간 뺀 것), 그중 밤 10시~아침 6시가 몇 분인지
  function span(sh) {
    const s = toMin(sh && sh.start);
    let e = toMin(sh && sh.end);
    if (s === null || e === null) return null;
    if (e <= s) e += DAY; // 자정을 넘겨요 (예: 22:00~02:00)
    const raw = e - s;
    const brk = Math.min(raw, Math.max(0, Math.round(Number(sh.breakMin) || 0)));
    const paid = raw - brk;
    let night = 0;
    for (const [a, b] of NIGHT) night += Math.max(0, Math.min(e, b) - Math.max(s, a));
    return { start: s, end: e, raw, brk, paid, night: Math.min(night, paid) };
  }

  function deductions(job, gross) {
    const d = {};
    if (job.deduct === 'tax33') {
      d.incomeTax = floor10(gross * RATES.incomeTax);
      d.localTax = floor10(d.incomeTax * RATES.localTax);
    } else if (job.deduct === 'ins') {
      if (job.ins.pension) d.pension = floor10(gross * RATES.pension);
      if (job.ins.health) { d.health = floor10(gross * RATES.health); d.care = floor10(d.health * RATES.care); }
      if (job.ins.employ) d.employ = floor10(gross * RATES.employ);
    }
    return d;
  }

  // ym = 'YYYY-MM', weekStart = 0(일) | 1(월)
  function month(jobsIn, shiftsIn, ym, { weekStart = 1 } = {}) {
    const first = dayNum(`${ym}-01`);
    const [y, m] = ym.split('-').map(Number);
    const last = dayNum(numDay(Math.floor(Date.UTC(y, m, 0) / 86400000)));
    // 이 달에 걸친 주들: 첫 주 시작 ~ 마지막 주 끝
    const wkStart = (n) => n - ((weekday(n) - weekStart + 7) % 7);
    const from = wkStart(first);
    const to = wkStart(last) + 6;
    const jobs = (jobsIn || []).map(normalizeJob);
    const out = [];
    for (const job of jobs) {
      const mine = (shiftsIn || []).filter((x) => x.jobId === job.id && x.date && dayNum(x.date) >= from && dayNum(x.date) <= to)
        .map((x) => ({ sh: x, n: dayNum(x.date), sp: span(x) })).filter((x) => x.sp);
      const r = { job, days: 0, shifts: 0, paidMin: 0, nightMin: 0, otMin: 0, base: 0, weekly: 0, night: 0, overtime: 0, weeks: [] };
      const inMonth = (n) => n >= first && n <= last;
      // 하루 단위: 기본급 · 야간 · 하루 8시간 넘는 연장
      const byDay = new Map();
      for (const x of mine) {
        if (!byDay.has(x.n)) byDay.set(x.n, []);
        byDay.get(x.n).push(x);
      }
      const dayOt = new Map();
      for (const [n, list] of byDay) {
        const paid = list.reduce((a, x) => a + x.sp.paid, 0);
        const ot = job.fivePlus ? Math.max(0, paid - 480) : 0;
        dayOt.set(n, ot);
        if (!inMonth(n)) continue;
        r.days += 1;
        r.shifts += list.length;
        r.paidMin += paid;
        const night = list.reduce((a, x) => a + x.sp.night, 0);
        if (job.fivePlus) { r.nightMin += night; r.otMin += ot; }
      }
      // 주 단위: 주휴수당 · 주 40시간 넘는 연장 (그 주가 끝나는 날이 이 달이면 이 달에 넣어요)
      for (let w = from; w <= to; w += 7) {
        const we = w + 6;
        let paid = 0;
        let ot = 0;
        for (const x of mine) if (x.n >= w && x.n <= we) paid += x.sp.paid;
        for (const [n, v] of dayOt) if (n >= w && n <= we) ot += v;
        const weekOt = job.fivePlus ? Math.max(0, paid - ot - 2400) : 0;
        const weeklyOn = job.weekly && paid >= RATES.weeklyMinHours * 60;
        const weeklyHours = weeklyOn ? (Math.min(paid, 2400) / 60 / 40) * 8 : 0;
        const counted = inMonth(we);
        r.weeks.push({ start: numDay(w), end: numDay(we), paidMin: paid, weeklyHours, weekOtMin: weekOt, counted });
        if (!counted) continue;
        r.weekly += weeklyHours * job.wage;
        r.otMin += weekOt;
      }
      r.base = won((r.paidMin / 60) * job.wage);
      r.weekly = won(r.weekly);
      r.night = won((r.nightMin / 60) * job.wage * 0.5);
      r.overtime = won((r.otMin / 60) * job.wage * 0.5);
      r.gross = r.base + r.weekly + r.night + r.overtime;
      r.ded = deductions(job, r.gross);
      r.dedTotal = Object.values(r.ded).reduce((a, v) => a + v, 0);
      r.net = r.gross - r.dedTotal;
      out.push(r);
    }
    const sum = (k) => out.reduce((a, r) => a + r[k], 0);
    return { ym, jobs: out, total: { paidMin: sum('paidMin'), gross: sum('gross'), dedTotal: sum('dedTotal'), net: sum('net'), days: new Set((shiftsIn || []).filter((x) => x.date && x.date.slice(0, 7) === ym && jobs.some((j) => j.id === x.jobId)).map((x) => x.date)).size } };
  }

  const DED_LABEL = { incomeTax: '소득세 (3%)', localTax: '지방소득세 (0.3%)', pension: '국민연금 (4.75%)', health: '건강보험 (3.595%)', care: '장기요양보험', employ: '고용보험 (0.9%)' };
  const hoursText = (min) => { const h = Math.floor(min / 60); const mm = min % 60; return mm ? `${h}시간 ${mm}분` : `${h}시간`; };
  const moneyText = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;

  return { RATES, DED_LABEL, toMin, span, normalizeJob, month, deductions, hoursText, moneyText };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WorkPay;
