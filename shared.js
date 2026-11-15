'use strict';

/* =========================================================================
 * 메인 화면과 위젯이 같이 쓰는 코드: 날짜, 색상 변환, 테마 계산, 공휴일
 * ========================================================================= */

// ---------- 날짜 ----------
const DAY_MS = 86400000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / DAY_MS);
const isWeekendStr = (s) => { const w = parseYmd(s).getDay(); return w === 0 || w === 6; };
const epochDays = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };
const fromEpochDays = (n) => { const d = new Date(n * DAY_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 디데이: 앞으로 남은 날은 D-n, 지난 날은 한국식 기념일 계산 (시작한 날 = 1일, 카카오톡과 같아요)
//   예) 2026-01-01 시작 → 1월 1일 "1일", 1월 2일 "2일", 100일째 = 4월 10일
function ddayInfo(date) {
  const diff = diffDays(date, todayStr());
  const nth = 1 - diff; // 지난 날이면 오늘이 며칠째인지 (당일 = 1일)
  return {
    diff,
    nth,
    label: diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `${nth.toLocaleString('ko-KR')}일`,
    sub: diff > 0 ? `${diff}일 남았어요` : diff === 0 ? '바로 오늘이에요! (1일째)' : `${nth.toLocaleString('ko-KR')}일째예요`,
  };
}

// 디데이 색: 디데이마다 따로 고른 색 → (설정이 '직접 고르기'면) 디데이 기본 색 → 메인 색
function ddayColor(x, settings) {
  if (x && x.color) return x.color;
  if (settings && settings.ddayColorMode === 'custom' && settings.ddayColor) return settings.ddayColor;
  return 'var(--accent)';
}

// ---------- 색상 변환 ----------
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
function hexToRgb(hx) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hx || '').trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => clampN(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((u) => Math.round(u * 255));
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clampN(s, 0, 100) / 100;
  l = clampN(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// ---------- 테마 (메인 색 하나로 전체 색 자동 계산) ----------
const DEFAULT_ACCENT = '#ff7d9c';
const ACCENT_PRESETS = ['#ff7d9c', '#ff8f6b', '#f5b03d', '#6cc58a', '#3fbfae', '#5aa9f0', '#7d8cff', '#a68cff', '#e58ad6', '#a8937c'];
// 기본(핑크) 테마의 실제 색이에요. 메인 색을 바꾸면 이 색들의 색상(hue)을 같은 만큼 돌리고,
// 채도는 같은 비율로 맞춰서 지금 앱과 똑같은 톤 비율을 유지해요.
const THEME_BASE = {
  light: {
    accent: '#ff7d9c',
    neutral: { bg: '#fff9f4', 'bg-soft': '#fff1e8', sidebar: '#fdf0e6', panel: '#ffffff', text: '#4b3f4c', 'text-2': '#7c6f7f', 'text-3': '#b3a6b2', border: '#f2e3da', hover: '#fdeae0', 'toast-bg': '#4b3f4c', p0: '#d6c7cf', 'shadow-c': '#af6e6e' },
    tint: { active: '#ffe2ea', 'toast-btn': '#ffc2d1' }, // 밝기는 그대로
    tone: { 'accent-2': '#f2668a', 'accent-lt': '#ffa3b8', 'accent-dk': '#ff7096' }, // 밝기도 메인 색을 따라 이동
    alpha: { soft: 0.14, dot: 0.3, shadow: 0.18, shadowSoft: 0.09, shadowHover: 0.13, backdrop: 0.32 },
  },
  dark: {
    accent: '#ff8fab',
    neutral: { bg: '#1f1b24', 'bg-soft': '#29232f', sidebar: '#1a1720', panel: '#27212e', text: '#f4ecf3', 'text-2': '#c7b9c6', 'text-3': '#85778a', border: '#372e3f', hover: '#322a3a', 'toast-bg': '#3d3346', p0: '#6c6072', 'shadow-c': '#000000' },
    tint: { active: '#43283a', 'toast-btn': '#ffc2d1' },
    tone: { 'accent-2': '#ffa6bd', 'accent-lt': '#ffa3b8', 'accent-dk': '#ff7096' },
    alpha: { soft: 0.16, dot: 0.22, shadow: 0.5, shadowSoft: 0.25, shadowHover: 0.35, backdrop: 0.5 },
  },
};

function themeVars(accentHex, mode) {
  const base = THEME_BASE[mode];
  const [bh, bs, bl] = rgbToHsl(...hexToRgb(base.accent));
  const [h, s, l0] = rgbToHsl(...(hexToRgb(accentHex) || hexToRgb(DEFAULT_ACCENT)));
  let l = l0;
  if (mode === 'dark') l = clampN(l0 + (bl - rgbToHsl(...hexToRgb(THEME_BASE.light.accent))[2]), 55, 88);
  const angle = (a) => ((((a + 180) % 360) + 360) % 360) - 180; // -180~180
  // 핑크와 가까운 색이면 지금 앱의 색상 관계(크림 배경 등)를 그대로 따르고,
  // 멀어질수록 배경·테두리도 메인 색의 색상으로 물들여서 어색한 조합(파랑+초록 배경 등)이 안 나오게 해요.
  const w = clampN(1 - Math.abs(angle(h - bh)) / 90, 0, 1);
  const sr = bs ? s / bs : 1;
  const dl = l - bl;
  const conv = (hex, shiftL) => {
    const [hh, ss, ll] = rgbToHsl(...hexToRgb(hex));
    return hslToHex(h + angle(hh - bh) * w, clampN(ss * sr, 0, 100), clampN(ll + (shiftL ? dl : 0), 0, 100));
  };
  const v = {};
  for (const [k, hex] of Object.entries(base.neutral)) v[k] = conv(hex, false);
  for (const [k, hex] of Object.entries(base.tint)) v[k] = conv(hex, false);
  for (const [k, hex] of Object.entries(base.tone)) v[k] = conv(hex, true);
  v.accent = mode === 'dark' ? hslToHex(h, s, l) : rgbToHex(...(hexToRgb(accentHex) || hexToRgb(DEFAULT_ACCENT)));
  const [ar, ag, ab] = hexToRgb(v.accent);
  const rgba = (a) => `rgba(${ar}, ${ag}, ${ab}, ${a})`;
  const [cr, cg, cb] = hexToRgb(v['shadow-c']);
  const sh = (a) => `rgba(${cr}, ${cg}, ${cb}, ${a})`;
  const [tr, tg, tb] = hexToRgb(v['toast-bg']);
  v['accent-soft'] = rgba(base.alpha.soft);
  v.dot = rgba(base.alpha.dot);
  v.shadow = `0 14px 40px ${sh(base.alpha.shadow)}`;
  v['shadow-soft'] = `0 3px 12px ${sh(base.alpha.shadowSoft)}`;
  v['shadow-hover'] = `0 6px 18px ${sh(base.alpha.shadowHover)}`;
  v.backdrop = `rgba(${tr}, ${tg}, ${tb}, ${base.alpha.backdrop})`;
  delete v['shadow-c'];
  return v;
}

function applyThemeVars(settings, root = document.documentElement) {
  const t = settings.theme;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  const vars = themeVars(settings.accent || DEFAULT_ACCENT, dark ? 'dark' : 'light');
  // 완료한 항목 흐림 정도: 0이면 그대로, 100이면 아주 흐리고 회색에 가깝게
  const dim = clampN(Number(settings.doneDim ?? 60), 0, 100) / 100;
  vars['done-op'] = (1 - dim * 0.8).toFixed(3);
  vars['done-sat'] = (1 - dim * 0.95).toFixed(3);
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(`--${k}`, val);
  return vars;
}

// ---------- 공휴일 (대체공휴일 포함) ----------
// 설날·부처님오신날·추석은 Chromium에 들어 있는 한국 음력(dangi) 달력으로 계산해요.
const EXTRA_HOLIDAYS = {
  2024: [['2024-04-10', '국회의원 선거일'], ['2024-10-01', '임시공휴일']],
  2025: [['2025-01-27', '임시공휴일'], ['2025-06-03', '대통령 선거일']],
  2026: [['2026-06-03', '지방선거일']],
};
const WEEKEND_SUB = new Set(['삼일절', '어린이날', '광복절', '개천절', '한글날', '부처님오신날', '크리스마스']);
let dangiFmt = null;
try { dangiFmt = new Intl.DateTimeFormat('en-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' }); } catch (_) { dangiFmt = null; }

function lunarHolidays(year) {
  const out = {};
  if (!dangiFmt) return out;
  for (let t = Date.UTC(year, 0, 1, 3); new Date(t).getUTCFullYear() === year; t += DAY_MS) {
    let m = '';
    let d = '';
    for (const p of dangiFmt.formatToParts(new Date(t))) {
      if (p.type === 'month') m = p.value; // 윤달은 "6bis"처럼 나와서 자동으로 제외돼요
      else if (p.type === 'day') d = p.value;
    }
    const key = `${m}/${d}`;
    if (key === '1/1' || key === '4/8' || key === '8/15') out[key] = fromEpochDays(Math.floor(t / DAY_MS));
  }
  return out;
}

const holidayCache = new Map();
function holidaysOf(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const names = new Map();
  const add = (d, n) => { if (!names.has(d)) names.set(d, []); names.get(d).push(n); };
  const fixed = [['01-01', '신정'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['06-06', '현충일'], ['08-15', '광복절'], ['10-03', '개천절'], ['10-09', '한글날'], ['12-25', '크리스마스']];
  if (year >= 2026) fixed.push(['05-01', '노동절'], ['07-17', '제헌절']);
  for (const [md, n] of fixed) add(`${year}-${md}`, n);

  const L = lunarHolidays(year);
  const periods = [];
  const addPeriod = (center, name) => {
    const p = [addDays(center, -1), center, addDays(center, 1)];
    p.forEach((d, i) => add(d, i === 1 ? name : `${name} 연휴`));
    periods.push(p);
  };
  if (L['1/1']) addPeriod(L['1/1'], '설날');
  if (L['4/8']) add(L['4/8'], '부처님오신날');
  if (L['8/15']) addPeriod(L['8/15'], '추석');
  for (const [d, n] of EXTRA_HOLIDAYS[year] || []) add(d, n);

  // 대체공휴일: 설·추석은 일요일이나 다른 공휴일과 겹치면 연휴 다음 평일,
  // 어린이날은 주말·공휴일과 겹치면, 국경일·부처님오신날·크리스마스는 주말과 겹치면 다음 평일
  const taken = new Set(names.keys());
  const inPeriod = new Set(periods.flat());
  const events = [];
  for (const p of periods) {
    if (p.some((d) => parseYmd(d).getDay() === 0 || names.get(d).length > 1)) events.push(p[2]);
  }
  for (const [d, list] of names) {
    if (inPeriod.has(d)) continue;
    if ((isWeekendStr(d) && list.some((n) => WEEKEND_SUB.has(n))) || (list.length > 1 && list.includes('어린이날'))) events.push(d);
  }
  events.sort();
  for (const d of events) {
    let x = addDays(d, 1);
    while (isWeekendStr(x) || taken.has(x)) x = addDays(x, 1);
    taken.add(x);
    add(x, '대체공휴일');
  }

  const result = new Map();
  for (const [d, list] of names) result.set(d, list.filter((n, i, a) => a.indexOf(n) === i).join(' · '));
  holidayCache.set(year, result);
  return result;
}
