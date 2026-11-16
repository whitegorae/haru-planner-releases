'use strict';

/* =========================================================================
 * HaruPlanner 모바일 (홈 화면에 추가해서 쓰는 웹 앱 · PWA)
 *  - 데스크톱과 같은 Supabase 계정·테이블을 쓰고, cloud.js 로 실시간 동기화해요.
 *  - 데이터 형식(할 일·목록·디데이·설정)은 데스크톱 app.js 와 똑같아야 해요.
 *  - ?demo 를 붙이면 로그인 없이 예시 데이터로 화면만 볼 수 있어요 (저장 안 됨).
 * ========================================================================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = escHtml;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DEMO = new URLSearchParams(location.search).has('demo');
const APP_VERSION = (window.api && window.api.version) || '';

// ---------- 데스크톱과 같은 상수 ----------
const PRIORITY = [{ v: 3, label: '높음' }, { v: 2, label: '중간' }, { v: 1, label: '낮음' }, { v: 0, label: '없음' }];
const REPEATS = [
  { v: 'none', label: '반복 안 함' }, { v: 'daily', label: '매일' }, { v: 'weekdays', label: '평일마다' },
  { v: 'weekly', label: '매주' }, { v: 'monthly', label: '매월' }, { v: 'yearly', label: '매년' },
];
const REMINDS = [
  { v: '', label: '알림 없음' }, { v: '0', label: '정시에' }, { v: '5', label: '5분 전' }, { v: '15', label: '15분 전' },
  { v: '30', label: '30분 전' }, { v: '60', label: '1시간 전' }, { v: '1440', label: '하루 전' },
];
const PRESET_COLORS = ['#ff8fab', '#ff9b73', '#ffc95c', '#8fd694', '#6fd1c4', '#7fb8ff', '#8f9cff', '#c49bff', '#f49ad6', '#b8a99a', '#ff6b81', '#5a8dee'];

// ---------- 아이콘 ----------
const ICONS = {
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v3.5M16 3v3.5"/><text x="12" y="17.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none">{d}</text>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v3.5M16 3v3.5M3.5 10h17"/><circle cx="8.5" cy="14.5" r=".6" fill="currentColor"/><circle cx="12" cy="14.5" r=".6" fill="currentColor"/><circle cx="15.5" cy="14.5" r=".6" fill="currentColor"/>',
  lists: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5" cy="6.5" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17.5" r="1.2" fill="currentColor"/>',
  dday: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.5a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  check: '<path d="M5.5 12.5l4.2 4.2L18.5 8"/>',
  flag: '<path d="M5.5 21V4.5M5.5 4.5h10.3a.8.8 0 0 1 .7 1.2L15 8.5l1.5 2.8a.8.8 0 0 1-.7 1.2H5.5"/>',
  repeat: '<path d="M17 2.5l3 3-3 3"/><path d="M4 11V9.5a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3"/><path d="M20 13v1.5a4 4 0 0 1-4 4H4"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9M10.2 20.5a2 2 0 0 0 3.6 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chevL: '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
  chevR: '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
  chevD: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 11.6A2 2 0 0 0 9.4 20.5h5.2a2 2 0 0 0 2-1.9L17.5 7M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  send: '<path d="M12 19V5.5M6 11.5l6-6 6 6"/>',
  palette: '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.2 0 1.7-.8 1.7-1.6 0-1-.7-1.3-.7-2.1 0-.9.7-1.6 1.7-1.6h2.2a4 4 0 0 0 4-4c0-4.6-4-8.3-8.9-8.3Z"/><circle cx="7.6" cy="11.2" r="1.1" fill="currentColor"/><circle cx="10.2" cy="7.4" r="1.1" fill="currentColor"/><circle cx="14.6" cy="7.4" r="1.1" fill="currentColor"/>',
  inbox: '<path d="M4 13l2.6-6.6A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.4L20 13v4.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V13Z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
  week: '<path d="M4 6.5h16M4 12h16M4 17.5h9"/><circle cx="18.5" cy="17.5" r="1.6"/>',
  all: '<rect x="4" y="4" width="7" height="7" rx="2.5"/><rect x="13" y="4" width="7" height="7" rx="2.5"/><rect x="4" y="13" width="7" height="7" rx="2.5"/><rect x="13" y="13" width="7" height="7" rx="2.5"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-4.9"/>',
  note: '<rect x="5" y="3.5" width="14" height="17" rx="3.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5L7 17M17 7l1.5-1.5"/>',
  sunrise: '<path d="M6 18a6 6 0 0 1 12 0M3 18h18M12 3.5v5M9.5 6l2.5-2.5L14.5 6M4.3 11.3l1.5 1.2M19.7 11.3l-1.5 1.2M7 21h10"/>',
  plus7: '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v3.5M16 3v3.5"/><text x="12" y="17.4" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" stroke="none">+7</text>',
  nodate: '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v3.5M16 3v3.5M9 11.5l6 6M15 11.5l-6 6"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M6 11.5H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 19 11.5h-1"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.5 18.5Z"/>',
};
function icon(name, cls = '') {
  let b = ICONS[name] || '';
  if (name === 'today') b = b.replace('{d}', new Date().getDate());
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
}

// ---------- 상태 ----------
const state = {
  data: null,
  tab: 'today', // today | calendar | lists | dday | settings
  listView: null, // 목록 탭에서 들어간 목록: 'next7' | 'all' | 'done' | 'list:<id>'
  calMonth: todayStr().slice(0, 7), // YYYY-MM
  calSel: todayStr(),
  offline: false, // 클라우드에 못 붙어서 마지막으로 저장한 화면만 보여주는 중
  showDone: {},
};

// ---------- 데이터 모델 (데스크톱 app.js 와 같은 형식) ----------
function makeTask(p = {}) {
  return {
    id: uid(), title: '', notes: '', listId: 'inbox', dueDate: null, endDate: null, dueTime: null, endTime: null,
    color: null, priority: 0, done: false, doneAt: null, createdAt: Date.now(), repeat: 'none', remind: null, reminded: null,
    subtasks: [], timeSpent: 0, ...p,
  };
}
function baseSettings() {
  return {
    theme: 'system', accent: DEFAULT_ACCENT, weekStart: 0, sound: true, showHolidays: true, calScroll: 'free', doneDim: 60,
    widgetOpacity: 0.6, ddayWidgetId: null, ddayColorMode: 'accent', ddayColor: '#ff8fab', ddayColorV: 1, timerMode: 'countdown', countdownMin: 25,
  };
}
function defaultData() {
  return {
    version: 3,
    lists: [{ id: 'inbox', name: '수신함', color: '#8f9cff', system: true }, { id: uid(), name: '개인', color: '#8fd694' }, { id: uid(), name: '업무', color: '#ff9b73' }],
    tasks: [], ddays: [], sessions: [], photos: [], activeTimer: null, settings: baseSettings(),
  };
}
function normalize(data) {
  const base = defaultData();
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) return base;
  data.version = 3;
  data.lists = Array.isArray(data.lists) && data.lists.length ? data.lists : base.lists;
  if (!data.lists.some((l) => l.id === 'inbox')) data.lists.unshift(base.lists[0]);
  data.tasks = data.tasks.map((t) => ({ ...makeTask(), ...t, subtasks: Array.isArray(t.subtasks) ? t.subtasks : [] }));
  data.ddays = Array.isArray(data.ddays) ? data.ddays : [];
  data.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  data.photos = Array.isArray(data.photos) ? data.photos : [];
  data.activeTimer = data.activeTimer || null;
  data.settings = { ...baseSettings(), ...(data.settings || {}) };
  return data;
}
const S = () => state.data.settings;
const listById = (id) => state.data.lists.find((l) => l.id === id) || state.data.lists[0];
const taskById = (id) => state.data.tasks.find((t) => t.id === id);
const taskEnd = (t) => (t.endDate && t.dueDate && t.endDate > t.dueDate ? t.endDate : t.dueDate);
const taskColor = (t) => t.color || listById(t.listId).color;
const hm = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const hmStr = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const dueKey = (t) => `${t.dueDate || '9999-99-99'} ${t.dueTime || '99:99'}`;
const sortTasks = (arr) => arr.slice().sort((a, b) => (a.done - b.done) || (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0) || (b.priority - a.priority) || (a.createdAt - b.createdAt));
const nowHm = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
function isOverdue(t) {
  if (t.done || !t.dueDate) return false;
  const today = todayStr();
  const end = taskEnd(t);
  if (end < today) return true;
  return end === today && t.dueTime && end === t.dueDate && (t.endTime || t.dueTime) < nowHm();
}
const tasksOn = (d) => sortTasks(state.data.tasks.filter((t) => t.dueDate && t.dueDate <= d && taskEnd(t) >= d));
const holidayOf = (d) => (S().showHolidays ? holidaysOf(Number(d.slice(0, 4))).get(d) || null : null);
const ddColor = (x) => ddayColor(x, S());
function fixEndTime(t) {
  if (!t.dueTime) { t.endTime = null; return; }
  if (t.endTime && taskEnd(t) === t.dueDate && hm(t.endTime) <= hm(t.dueTime)) t.endTime = null;
}
function nextRepeatDate(s, repeat) {
  const d = parseYmd(s);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); } else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly' || repeat === 'yearly') {
    const day = d.getDate();
    const target = new Date(d.getFullYear(), d.getMonth() + (repeat === 'monthly' ? 1 : 12), 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, last));
    return ymd(target);
  }
  return ymd(d);
}

// ---------- 날짜 글자 ----------
function timeLabel(t) { const [h, m] = t.split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${pad(m)}`; }
const shortMd = (s) => { const x = parseYmd(s); return `${x.getMonth() + 1}월 ${x.getDate()}일`; };
function dateLabel(s) {
  const dd = diffDays(s, todayStr());
  if (dd === 0) return '오늘';
  if (dd === 1) return '내일';
  if (dd === 2) return '모레';
  if (dd === -1) return '어제';
  const d = parseYmd(s);
  const yr = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}년 `;
  return `${yr}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
function dueLabel(t) {
  if (!t.dueDate) return '';
  const end = taskEnd(t);
  if (end !== t.dueDate) return `${shortMd(t.dueDate)} – ${shortMd(end)}`;
  const time = t.dueTime ? (t.endTime ? `${timeLabel(t.dueTime)}–${timeLabel(t.endTime)}` : timeLabel(t.dueTime)) : '';
  return [dateLabel(t.dueDate), time].filter(Boolean).join(' ');
}
function draftLabel(d) {
  if (!d.date) return '날짜';
  if (d.endDate && d.endDate > d.date) return `${shortMd(d.date)} – ${shortMd(d.endDate)}`;
  return `${dateLabel(d.date)}${d.time ? ` ${timeLabel(d.time)}${d.endTime ? `–${timeLabel(d.endTime)}` : ''}` : ''}`;
}

// ---------- 저장 / 동기화 ----------
const CACHE_KEY = 'haru-mobile-cache';
let cacheT = 0;
function saveCacheSoon() {
  if (DEMO) return;
  clearTimeout(cacheT);
  cacheT = setTimeout(() => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch (_) { /* 용량 초과 등 */ } }, 600);
}
function loadCache() { try { return normalize(JSON.parse(localStorage.getItem(CACHE_KEY))); } catch (_) { return null; } }
function save() {
  if (!DEMO && Cloud.isActive()) { Cloud.saveDevice(S()); Cloud.schedulePush(); }
  saveCacheSoon();
}
function commit() { save(); render(); }
const canEdit = () => {
  if (state.offline) { toast('오프라인이라 지금은 볼 수만 있어요. 연결되면 고칠 수 있어요.'); return false; }
  return true;
};
function withUndo(message, fn) {
  const snap = JSON.stringify({ tasks: state.data.tasks, ddays: state.data.ddays, lists: state.data.lists });
  fn();
  commit();
  toast(message, { action: '되돌리기', onAction: () => { Object.assign(state.data, JSON.parse(snap)); commit(); } });
}
function addTask(fields) {
  const t = makeTask(fields);
  fixEndTime(t);
  state.data.tasks.push(t);
  commit();
  return t;
}
function toggleDone(id) {
  const t = taskById(id);
  if (!t || !canEdit()) return;
  if (navigator.vibrate) navigator.vibrate(12);
  if (!t.done && t.repeat !== 'none' && t.dueDate) {
    let next;
    withUndo('완료했어요', () => {
      const copy = { ...JSON.parse(JSON.stringify(t)), id: uid(), done: true, doneAt: Date.now(), repeat: 'none', remind: null };
      state.data.tasks.push(copy);
      t.gcal = null;
      const span = diffDays(taskEnd(t), t.dueDate);
      next = nextRepeatDate(t.dueDate, t.repeat);
      t.dueDate = next;
      t.endDate = span > 0 ? addDays(next, span) : null;
      t.reminded = null;
      t.subtasks.forEach((s) => { s.done = false; });
    });
    toast(`다음 반복: ${dateLabel(next)}`);
    return;
  }
  withUndo(t.done ? '다시 진행 중으로 바꿨어요' : '완료했어요', () => { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; });
}
function deleteTask(id) {
  const t = taskById(id);
  if (!t || !canEdit()) return;
  withUndo(`"${t.title}" 삭제했어요`, () => { state.data.tasks = state.data.tasks.filter((x) => x.id !== id); });
}

// ---------- 테마 ----------
function applyTheme() {
  const s = state.data ? S() : baseSettings();
  const vars = applyThemeVars(s);
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', vars.bg));
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

// ---------- 토스트 ----------
function toast(message, { action, onAction, timeout = 3500 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'm-toast';
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  box.appendChild(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  if (action) el.querySelector('button').addEventListener('click', () => { kill(); onAction(); });
  setTimeout(kill, timeout);
  while (box.children.length > 3) box.firstChild.remove();
}

// =====================================================================
// 화면
// =====================================================================
const TABS = [
  { k: 'today', label: '오늘', ic: 'today' },
  { k: 'calendar', label: '캘린더', ic: 'calendar' },
  { k: 'lists', label: '목록', ic: 'lists' },
  { k: 'dday', label: '디데이', ic: 'dday' },
  { k: 'settings', label: '설정', ic: 'settings' },
];

function render() {
  if (!state.data) return;
  syncWidget();
  const app = $('#app');
  if (!app.querySelector('.m-tabs')) {
    app.innerHTML = `<main id="view" class="m-view"></main>
      <button class="m-fab" data-a="fab" aria-label="추가">${icon('plus')}</button>
      <nav class="m-tabs">${TABS.map((t) => `<button data-a="tab" data-k="${t.k}"><span class="m-tab-ic">${icon(t.ic)}</span><span>${t.label}</span></button>`).join('')}</nav>`;
  }
  $$('.m-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === state.tab));
  $('.m-fab').hidden = state.tab === 'settings';
  const view = $('#view');
  const keep = view.dataset.tab === state.tab + (state.listView || '') ? view.scrollTop : 0;
  view.dataset.tab = state.tab + (state.listView || '');
  view.innerHTML = ({ today: viewToday, calendar: viewCalendar, lists: viewLists, dday: viewDday, settings: viewSettings })[state.tab]();
  view.scrollTop = keep;
  Photos.hydrate(view);
}

function syncDot(compact = false) {
  const c = compact ? ' compact' : '';
  if (DEMO) return `<span class="m-sync demo${c}">${compact ? '' : '미리보기'}</span>`;
  if (state.offline) return `<span class="m-sync off${c}">${compact ? '' : '오프라인'}</span>`;
  const st = Cloud.status().status;
  return `<span class="m-sync ${st}${c}" title="${st === 'online' ? '동기화됨' : st === 'syncing' ? '동기화 중' : '연결 끊김'}"><i></i>${compact || st === 'online' ? '' : st === 'syncing' ? '동기화 중' : '오프라인'}</span>`;
}
// right: 오른쪽에 둘 버튼들 (있으면 동기화 표시는 점으로만)
function head(title, sub = '', left = '', right = '') {
  return `<header class="m-head">${left}<div class="m-head-t"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><span class="flex1"></span>${right ? `${right}${syncDot(true)}` : syncDot()}</header>`;
}

function taskRow(t, { hideDate = false } = {}) {
  const list = listById(t.listId);
  const due = t.dueDate && !(hideDate && !t.dueTime && taskEnd(t) === t.dueDate) ? (hideDate && taskEnd(t) === t.dueDate ? (t.endTime ? `${timeLabel(t.dueTime)}–${timeLabel(t.endTime)}` : timeLabel(t.dueTime)) : dueLabel(t)) : '';
  const subs = t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : '';
  return `<div class="m-task ${t.done ? 'done' : ''}" style="--c:${esc(taskColor(t))}" data-a="open-task" data-id="${t.id}">
    <button class="m-check p${t.priority} ${t.done ? 'on' : ''}" data-a="toggle" data-id="${t.id}" aria-label="완료">${icon('check')}</button>
    <div class="m-task-body">
      <div class="m-task-title">${esc(t.title) || '제목 없음'}</div>
      <div class="m-task-meta">
        ${due ? `<span class="${isOverdue(t) ? 'over' : ''}">${esc(due)}</span>` : ''}
        ${t.repeat && t.repeat !== 'none' ? icon('repeat', 'mini') : ''}${t.remind != null ? icon('bell', 'mini') : ''}
        ${t.notes ? icon('note', 'mini') : ''}${subs ? `<span>${subs}</span>` : ''}
        ${t.listId !== 'inbox' ? `<span class="m-tag"><i style="background:${esc(list.color)}"></i>${esc(list.name)}</span>` : ''}
      </div>
    </div>
    ${t.priority ? `<span class="m-flag p${t.priority}">${icon('flag')}</span>` : ''}
  </div>`;
}
function section(key, title, tasks, { collapsed = false, hideDate = false, count = true } = {}) {
  if (!tasks.length) return '';
  const closed = state.showDone[key] === undefined ? collapsed : !state.showDone[key];
  return `<section class="m-sec">
    <button class="m-sec-h" data-a="sec" data-k="${key}" data-def="${collapsed ? 1 : 0}">${icon('chevD', closed ? 'rot' : '')}<span>${title}</span>${count ? `<b>${tasks.length}</b>` : ''}</button>
    ${closed ? '' : `<div class="m-sec-b">${tasks.map((t) => taskRow(t, { hideDate })).join('')}</div>`}
  </section>`;
}
function empty(ic, text, sub = '') {
  return `<div class="m-empty">${icon(ic)}<p>${text}</p>${sub ? `<span>${sub}</span>` : ''}</div>`;
}

// ---- 사진 일기 ----
const photosOn = (d) => (state.data.photos || []).filter((p) => p.date === d).sort((a, b) => a.createdAt - b.createdAt);
function cellPhoto(d) {
  const ps = photosOn(d);
  return ps.length ? `<span class="m-cell-ph">${Photos.imgTag(ps[0].thumb)}</span>` : '';
}
function photoStrip(d, title = '사진') {
  const ps = photosOn(d);
  return `<div class="m-photos">
    <div class="m-photos-h"><span>${title}</span>${ps.length ? `<b>${ps.length}</b>` : ''}</div>
    <div class="m-photos-row">
      ${ps.map((p) => `<button class="m-ph" data-a="ph-open" data-d="${d}" data-id="${p.id}">${Photos.imgTag(p.thumb)}</button>`).join('')}
      <button class="m-ph add" data-a="ph-add" data-d="${d}" aria-label="사진 추가">${icon('plus')}<span>사진</span></button>
    </div>
  </div>`;
}
function photoReady() {
  if (DEMO) { toast('미리보기에서는 사진을 올릴 수 없어요. 로그인하면 쓸 수 있어요'); return false; }
  if (!canEdit()) return false;
  return true;
}
async function addPhotos(date, files) {
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    toast(`사진 올리는 중… ${files.length > 1 ? `(${i + 1}/${files.length})` : ''}`, { timeout: 2500 });
    try { state.data.photos.push(await Photos.add(date, files[i])); ok++; commit(); } catch (err) { toast(Photos.errText(err), { timeout: 6000 }); break; }
  }
  if (ok) toast(`사진 ${ok}장을 올렸어요`);
}
function openPhotos(date, startId) {
  if (DEMO) { toast('미리보기에서는 사진을 볼 수 없어요'); return; }
  Photos.openViewer({
    title: `${dateLabel(date)}의 사진`,
    startId,
    getList: () => photosOn(date),
    onAdd: async (file) => { if (!canEdit()) throw new Error('오프라인이에요'); state.data.photos.push(await Photos.add(date, file)); commit(); },
    onDelete: async (p) => { await Photos.removeFiles([p]); state.data.photos = state.data.photos.filter((x) => x.id !== p.id); commit(); },
    onCaption: (p, text) => { const x = state.data.photos.find((y) => y.id === p.id); if (x) { x.caption = text; commit(); } },
  });
}

// ---- 오늘 ----
function viewToday() {
  const t = todayStr();
  const d = parseYmd(t);
  const open = state.data.tasks.filter((x) => !x.done);
  const over = sortTasks(open.filter((x) => x.dueDate && taskEnd(x) < t));
  const today = sortTasks(open.filter((x) => x.dueDate && x.dueDate <= t && taskEnd(x) >= t));
  const doneToday = sortTasks(state.data.tasks.filter((x) => x.done && x.doneAt && ymd(new Date(x.doneAt)) === t));
  const nd = state.data.ddays.map((x) => ({ x, ...ddayInfo(x.date, x.style) })).filter((o) => o.diff >= 0).sort((a, b) => a.diff - b.diff)[0];
  const hol = holidayOf(t);
  return `${head('오늘', `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일${hol ? ` · ${esc(hol)}` : ''}`)}
    ${nd ? `<button class="m-dday-strip" data-a="tab" data-k="dday" style="--c:${esc(ddColor(nd.x))}"><b>${nd.label}</b><span>${esc(nd.x.title)}</span>${icon('chevR')}</button>` : ''}
    ${photoStrip(t, '오늘의 사진')}
    ${section('over', '지난 일정', over)}
    ${section('today', '오늘', today, { hideDate: true })}
    ${!over.length && !today.length ? empty('sun', '오늘 할 일이 없어요', '아래 + 를 눌러 추가해 보세요') : ''}
    ${section('doneToday', '오늘 완료', doneToday, { collapsed: true, hideDate: true })}
    <div class="m-bottom-space"></div>`;
}

// ---- 캘린더 ----
function viewCalendar() {
  const [y, m] = state.calMonth.split('-').map(Number);
  const first = `${state.calMonth}-01`;
  const ws = S().weekStart || 0;
  const lead = (new Date(y, m - 1, 1).getDay() - ws + 7) % 7;
  const start = addDays(first, -lead);
  const t = todayStr();
  const heads = Array.from({ length: 7 }, (_, i) => { const wd = (ws + i) % 7; return `<span class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">${WEEKDAYS[wd]}</span>`; }).join('');
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const wd = parseYmd(d).getDay();
    const out = d.slice(0, 7) !== state.calMonth;
    const items = tasksOn(d);
    const hol = holidayOf(d);
    const dd = state.data.ddays.find((x) => x.date === d);
    const shown = items.slice(0, 3);
    cells += `<button class="m-cell${out ? ' out' : ''}${d === t ? ' today' : ''}${d === state.calSel ? ' sel' : ''}${wd === 0 || hol ? ' sun' : wd === 6 ? ' sat' : ''}" data-a="cal-day" data-d="${d}">
      <span class="m-cell-n">${parseYmd(d).getDate()}</span>
      ${dd ? `<i class="m-cell-dd" style="background:${esc(ddColor(dd))}"></i>` : ''}${cellPhoto(d)}
      <span class="m-cell-bars">${shown.map((x) => `<span class="m-bar ${x.done ? 'done' : ''}" style="--c:${esc(taskColor(x))}">${esc(x.title)}</span>`).join('')}${items.length > 3 ? `<span class="m-more">+${items.length - 3}</span>` : ''}</span>
    </button>`;
    if (i === 34 && addDays(start, 35).slice(0, 7) !== state.calMonth) break; // 5주면 5줄만
  }
  const sel = state.calSel;
  const selItems = tasksOn(sel);
  const selHol = holidayOf(sel);
  const selDd = state.data.ddays.filter((x) => x.date === sel);
  const nav = `<div class="m-cal-nav"><button data-a="cal-move" data-dir="-1" aria-label="이전 달">${icon('chevL')}</button><button class="m-pill" data-a="cal-today">오늘</button><button data-a="cal-move" data-dir="1" aria-label="다음 달">${icon('chevR')}</button></div>`;
  return `${head(`${y}년 ${m}월`, '', '', nav)}
    <div class="m-cal" id="mCal"><div class="m-cal-wd">${heads}</div><div class="m-cal-grid">${cells}</div></div>
    <div class="m-day">
      <div class="m-day-h"><b>${dateLabel(sel)}</b>${selHol ? `<span class="m-hol">${esc(selHol)}</span>` : ''}${selDd.map((x) => `<span class="m-dd-chip" style="--c:${esc(ddColor(x))}">${icon('dday')}${esc(x.title)}</span>`).join('')}</div>
      ${photoStrip(sel)}
      ${selItems.length ? selItems.map((x) => taskRow(x, { hideDate: true })).join('') : `<p class="m-day-empty">일정이 없어요 · + 로 추가</p>`}
    </div>
    <div class="m-bottom-space"></div>`;
}

// ---- 목록 ----
function listViewInfo(k) {
  const t = todayStr();
  const all = state.data.tasks;
  if (k === 'next7') return { title: '다음 7일', tasks: sortTasks(all.filter((x) => !x.done && x.dueDate && x.dueDate <= addDays(t, 6) && taskEnd(x) >= t)), group: 'date' };
  if (k === 'all') return { title: '모든 할 일', tasks: sortTasks(all.filter((x) => !x.done)) };
  if (k === 'done') return { title: '완료됨', tasks: all.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) };
  if (k.startsWith('list:')) {
    const l = listById(k.slice(5));
    return { title: esc(l.name), color: l.color, tasks: sortTasks(all.filter((x) => x.listId === l.id && !x.done)), doneTasks: sortTasks(all.filter((x) => x.listId === l.id && x.done)) };
  }
  return { title: '', tasks: [] };
}
function viewLists() {
  if (state.listView) {
    const info = listViewInfo(state.listView);
    const back = `<button class="m-back" data-a="list-back" aria-label="뒤로">${icon('chevL')}</button>`;
    let body;
    if (info.group === 'date') {
      const groups = new Map();
      const t = todayStr();
      for (const x of info.tasks) { const k = x.dueDate < t ? t : x.dueDate; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
      body = [...groups.entries()].sort().map(([d, xs]) => section(`n7:${d}`, dateLabel(d), xs, { hideDate: true })).join('');
    } else body = info.tasks.map((x) => taskRow(x)).join('');
    return `${head(info.title, '', back)}
      ${body || empty('done', '할 일이 없어요')}
      ${info.doneTasks ? section(`done:${state.listView}`, '완료', info.doneTasks, { collapsed: true }) : ''}
      <div class="m-bottom-space"></div>`;
  }
  const t = todayStr();
  const open = state.data.tasks.filter((x) => !x.done);
  const cnt = (f) => open.filter(f).length;
  const row = (k, ic, name, n, color) => `<button class="m-list-row" data-a="list-open" data-k="${k}">${color ? `<i class="m-dot" style="background:${esc(color)}"></i>` : icon(ic)}<span>${name}</span><span class="flex1"></span>${n ? `<b>${n}</b>` : ''}${icon('chevR', 'chev')}</button>`;
  return `${head('목록')}
    <div class="m-card">
      ${row('next7', 'week', '다음 7일', cnt((x) => x.dueDate && x.dueDate <= addDays(t, 6) && taskEnd(x) >= t))}
      ${row('all', 'all', '모든 할 일', open.length)}
      ${row('list:inbox', 'inbox', '수신함', cnt((x) => x.listId === 'inbox'))}
    </div>
    <div class="m-card-h"><span>내 목록</span><button data-a="list-add">${icon('plus')}목록 추가</button></div>
    <div class="m-card">
      ${state.data.lists.filter((l) => l.id !== 'inbox').map((l) => row(`list:${l.id}`, '', esc(l.name), cnt((x) => x.listId === l.id), l.color)).join('') || '<p class="m-day-empty">목록이 없어요</p>'}
    </div>
    <div class="m-card">${row('done', 'done', '완료됨', 0)}</div>
    <div class="m-bottom-space"></div>`;
}

// ---- 디데이 ----
function viewDday() {
  const items = state.data.ddays.map((x) => ({ x, ...ddayInfo(x.date, x.style) }))
    .sort((a, b) => (a.diff < 0) - (b.diff < 0) || (a.diff >= 0 ? a.diff - b.diff : b.diff - a.diff));
  const d = (s) => { const x = parseYmd(s); return `${x.getFullYear()}년 ${x.getMonth() + 1}월 ${x.getDate()}일 (${WEEKDAYS[x.getDay()]})`; };
  return `${head('디데이', '기다리는 날까지 며칠 남았는지')}
    <div class="m-ddays">${items.map(({ x, label, sub, diff }) => `
      <button class="m-dd ${diff < 0 ? 'past' : ''} ${diff === 0 ? 'is-today' : ''}" style="--c:${esc(ddColor(x))}" data-a="dd-open" data-id="${x.id}">
        <span class="m-dd-l">${label}</span><span class="m-dd-t">${esc(x.title)}</span><span class="m-dd-s">${d(x.date)} · ${sub}</span>
      </button>`).join('') || empty('dday', '아직 디데이가 없어요', '+ 를 눌러 기다리는 날을 추가해 보세요')}</div>
    <div class="m-bottom-space"></div>`;
}

// ---- 설정 ----
function viewSettings() {
  const s = S();
  const user = !DEMO && Cloud.user();
  const st = DEMO ? null : Cloud.status();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const seg = (k, opts) => `<div class="m-seg">${opts.map(([v, l]) => `<button class="${String(s[k]) === String(v) ? 'on' : ''}" data-a="set" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  return `${head('설정', APP_VERSION ? `HaruPlanner ${esc(APP_VERSION)}` : '')}
    <div class="m-card m-pad">
      <div class="m-acc">${icon('cloud')}<div><b>${DEMO ? '미리보기 (저장 안 됨)' : esc(user ? user.email : '')}</b>
        <span>${DEMO ? '로그인하면 데스크톱과 실시간으로 맞춰져요' : state.offline ? '오프라인 · 마지막으로 받은 일정을 보여주는 중' : st.status === 'online' ? '데스크톱과 실시간 동기화 중' : st.status === 'syncing' ? '동기화 중…' : esc(st.msg || '연결을 기다리는 중…')}</span></div></div>
    </div>
    <div class="m-card m-pad">
      <div class="m-set"><span>테마</span>${seg('theme', [['system', '자동'], ['light', '밝게'], ['dark', '어둡게']])}</div>
      <div class="m-set col"><span>메인 색상</span><div class="m-swatches">${ACCENT_PRESETS.map((c) => `<button class="m-sw ${String(s.accent).toLowerCase() === c ? 'on' : ''}" style="--c:${c}" data-a="set" data-k="accent" data-v="${c}" aria-label="${c}"></button>`).join('')}</div></div>
      <div class="m-set"><span>디데이 색</span>${seg('ddayColorMode', [['accent', '메인 색'], ['custom', '직접']])}</div>
      ${s.ddayColorMode === 'custom' ? `<div class="m-set col"><span>디데이 기본 색</span><div class="m-swatches">${PRESET_COLORS.map((c) => `<button class="m-sw ${String(s.ddayColor).toLowerCase() === c ? 'on' : ''}" style="--c:${c}" data-a="set" data-k="ddayColor" data-v="${c}"></button>`).join('')}</div></div>` : ''}
      <div class="m-set"><span>한 주의 시작</span>${seg('weekStart', [[0, '일요일'], [1, '월요일']])}</div>
      <div class="m-set"><span>공휴일 표시</span>${seg('showHolidays', [[true, '켜기'], [false, '끄기']])}</div>
    </div>
    ${isAndroid && !ANDROID_APP ? `<div class="m-card m-pad m-install">
      <b>${icon('share')}안드로이드 앱(APK)으로 설치하기</b>
      <p>갤럭시는 앱 파일(APK)로 설치할 수도 있어요. 설치한 뒤에도 화면은 자동으로 최신이 돼요.</p>
      <a class="m-btn primary" href="HaruPlanner.apk" download>APK 받기</a>
      <p class="m-muted">처음 설치할 때 "출처를 알 수 없는 앱" 허용을 물어보면 허용해 주세요.</p>
    </div>` : ''}
    ${ANDROID_APP ? `<p class="m-foot">안드로이드 앱 ${esc(ANDROID_APP.slice(1).join('.'))}</p>` : ''}
    ${standalone || ANDROID_APP ? '' : `<div class="m-card m-pad m-install">
      <b>${icon('share')}홈 화면에 앱으로 추가하기</b>
      <p><b>아이폰 (Safari)</b>: 아래 공유 버튼 ${icon('share', 'mini')} → <b>홈 화면에 추가</b></p>
      <p><b>갤럭시 (Chrome · 삼성 인터넷)</b>: 오른쪽 위 ⋮ (또는 ≡) → <b>홈 화면에 추가 / 앱 설치</b></p>
      <p class="m-muted">추가한 아이콘으로 열면 주소창 없이 앱처럼 열려요. 처음 한 번은 다시 로그인해야 할 수 있어요.</p>
    </div>`}
    <div class="m-card m-pad">
      ${DEMO ? '<button class="m-btn primary" data-a="go-login">로그인하러 가기</button>' : `<button class="m-btn" data-a="resync">${icon('repeat')}지금 다시 맞추기</button><button class="m-btn danger" data-a="logout">로그아웃</button>`}
    </div>
    <p class="m-foot">알림은 데스크톱 앱에서 울려요. 모바일 웹 앱은 꺼져 있을 때 알림을 보낼 수 없어요.</p>
    <div class="m-bottom-space"></div>`;
}

// =====================================================================
// 아래에서 올라오는 시트 (할 일 추가·수정, 날짜, 우선순위, 디데이 …)
// =====================================================================
const sheets = [];
function openSheet(html, { cls = '', onClose, onMount } = {}) {
  const root = $('#sheetRoot');
  const wrap = document.createElement('div');
  wrap.className = 'm-sheet-wrap';
  wrap.innerHTML = `<div class="m-backdrop" data-a="sheet-close"></div><div class="m-sheet ${cls}"><div class="m-grab" data-a="sheet-close"></div>${html}</div>`;
  root.appendChild(wrap);
  const sh = { wrap, el: wrap.querySelector('.m-sheet'), onClose };
  sheets.push(sh);
  void wrap.offsetHeight; // 한 번 그리게 한 뒤 바로 올라오게 (애니메이션 프레임을 기다리지 않아요)
  wrap.classList.add('in');
  if (onMount) onMount(sh.el);
  dragToClose(sh);
  return sh;
}
function closeSheet(opts = {}) {
  const sh = sheets.pop();
  if (!sh) return;
  if (sh.onClose && !opts.silent) sh.onClose(opts);
  sh.wrap.classList.remove('in');
  setTimeout(() => sh.wrap.remove(), 260);
}
const topSheet = () => sheets[sheets.length - 1];
function rerenderSheet(sh, html) {
  const keepScroll = sh.el.scrollTop;
  sh.el.innerHTML = `<div class="m-grab" data-a="sheet-close"></div>${html}`;
  sh.el.scrollTop = keepScroll;
}
// 손잡이를 아래로 끌면 닫혀요
function dragToClose(sh) {
  const grab = sh.el.querySelector('.m-grab');
  if (!grab) return;
  let y0 = null;
  sh.el.addEventListener('touchstart', (e) => { if (e.target.closest('.m-grab')) y0 = e.touches[0].clientY; }, { passive: true });
  sh.el.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = Math.max(0, e.touches[0].clientY - y0); sh.el.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.el.addEventListener('touchend', (e) => {
    if (y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    sh.el.style.transform = '';
    if (dy > 90 && topSheet() === sh) closeSheet();
  });
}

// ---------- 할 일 시트 (추가 / 수정) ----------
let taskSheet = null; // { mode:'add'|'edit', id, d:{date,endDate,time,endTime,remind,repeat,priority,listId}, color }
function taskSheetHTML() {
  const ts = taskSheet;
  const d = ts.d;
  const t = ts.mode === 'edit' ? taskById(ts.id) : null;
  const list = listById(d.listId);
  return `<div class="m-ts">
    <div class="m-ts-top">
      ${t ? `<button class="m-check p${d.priority} ${t.done ? 'on' : ''}" data-a="ts-done">${icon('check')}</button>` : ''}
      <button class="m-chip date ${d.date ? '' : 'empty'}" data-a="ts-date">${icon('calendar')}<span>${esc(draftLabel(d))}</span>${d.repeat && d.repeat !== 'none' ? icon('repeat', 'mini') : ''}${d.remind != null ? icon('bell', 'mini') : ''}</button>
      <span class="flex1"></span>
      <button class="m-icbtn m-flag p${d.priority}" data-a="ts-prio" aria-label="우선순위">${icon('flag')}</button>
    </div>
    <textarea id="tsTitle" class="m-ts-title" rows="1" placeholder="무엇을 하고 싶으신가요?" enterkeyhint="${ts.mode === 'add' ? 'send' : 'done'}">${t ? esc(t.title) : esc(ts.title || '')}</textarea>
    <textarea id="tsNotes" class="m-ts-notes" rows="2" placeholder="메모">${t ? esc(t.notes || '') : esc(ts.notes || '')}</textarea>
    ${t && t.subtasks.length ? `<div class="m-subs">${t.subtasks.map((s) => `<button class="m-sub ${s.done ? 'on' : ''}" data-a="ts-sub" data-sub="${s.id}"><span class="m-check sm ${s.done ? 'on' : ''}">${icon('check')}</span>${esc(s.title)}</button>`).join('')}</div>` : ''}
    <div class="m-ts-colors" ${ts.colorsOpen ? '' : 'hidden'}>
      <button class="m-sw list ${ts.color ? '' : 'on'}" style="--c:${esc(list.color)}" data-a="ts-color" data-v="">목록</button>
      ${PRESET_COLORS.map((c) => `<button class="m-sw ${ts.color === c ? 'on' : ''}" style="--c:${c}" data-a="ts-color" data-v="${c}"></button>`).join('')}
    </div>
    <div class="m-ts-foot">
      <label class="m-chip list"><i style="background:${esc(list.color)}"></i><span>${esc(list.name)}</span>${icon('chevD', 'mini')}
        <select id="tsList" aria-label="목록">${state.data.lists.map((l) => `<option value="${l.id}" ${l.id === d.listId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <button class="m-icbtn" data-a="ts-colors" aria-label="색상"><span class="m-dotlg" style="background:${esc(ts.color || list.color)}"></span></button>
      <span class="flex1"></span>
      ${t ? `<button class="m-icbtn danger" data-a="ts-delete" aria-label="삭제">${icon('trash')}</button>` : `<button class="m-send" data-a="ts-save" aria-label="추가">${icon('send')}</button>`}
    </div>
  </div>`;
}
function openTaskSheet(mode, opts = {}) {
  if (!canEdit()) return;
  if (mode === 'edit') {
    const t = taskById(opts.id);
    if (!t) return;
    taskSheet = { mode, id: t.id, color: t.color || null, d: { date: t.dueDate, endDate: t.endDate, time: t.dueTime, endTime: t.endTime || null, remind: t.remind ?? null, repeat: t.repeat || 'none', priority: t.priority || 0, listId: t.listId } };
  } else {
    taskSheet = { mode, color: null, d: { date: opts.date ?? null, endDate: null, time: null, endTime: null, remind: null, repeat: 'none', priority: 0, listId: opts.listId || 'inbox' } };
  }
  openSheet(taskSheetHTML(), {
    cls: 'task',
    onMount: (el) => {
      const ti = $('#tsTitle', el);
      autoGrow(ti);
      autoGrow($('#tsNotes', el));
      if (mode === 'add') setTimeout(() => ti.focus(), 60);
    },
    onClose: ({ discard } = {}) => { // 바깥을 누르거나 내려서 닫아도 적어 둔 건 저장돼요
      const ts = taskSheet;
      taskSheet = null;
      if (!ts) return;
      if (ts.mode === 'add') { if (!discard) saveNewTask(ts); } else finishEdit(ts);
    },
  });
}
function refreshTaskSheet() {
  const sh = sheets.find((s) => s.el.classList.contains('task'));
  if (!sh || !taskSheet) return;
  const ti = $('#tsTitle', sh.el);
  const no = $('#tsNotes', sh.el);
  if (taskSheet.mode === 'add') { taskSheet.title = ti ? ti.value : taskSheet.title; taskSheet.notes = no ? no.value : taskSheet.notes; }
  rerenderSheet(sh, taskSheetHTML());
  autoGrow($('#tsTitle', sh.el));
  autoGrow($('#tsNotes', sh.el));
}
// 수정 중인 할 일에 바로 반영
function applyEdit() {
  if (!taskSheet || taskSheet.mode !== 'edit') return;
  const t = taskById(taskSheet.id);
  if (!t) return;
  const d = taskSheet.d;
  if (t.dueDate !== d.date || t.dueTime !== d.time || t.remind !== d.remind) t.reminded = null;
  Object.assign(t, { dueDate: d.date, endDate: d.endDate, dueTime: d.time, endTime: d.endTime, remind: d.date ? d.remind : null, repeat: d.date ? d.repeat || 'none' : 'none', priority: d.priority, listId: d.listId, color: taskSheet.color });
  fixEndTime(t);
  commit();
}
function finishEdit(ts) {
  const t = taskById(ts.id);
  if (!t) return;
  if (!String(t.title || '').trim()) t.title = '제목 없음';
  commit();
}
function saveNewTask(ts) {
  const el = $('#tsTitle');
  const title = (el ? el.value : ts.title || '').trim();
  if (!title) return false;
  const notes = ($('#tsNotes') ? $('#tsNotes').value : ts.notes || '').replace(/\s+$/, '');
  const d = ts.d;
  addTask({ title, notes, listId: d.listId, color: ts.color, priority: d.priority, dueDate: d.date, endDate: d.endDate, dueTime: d.time, endTime: d.endTime, remind: d.date ? d.remind : null, repeat: d.date ? d.repeat : 'none' });
  toast(`"${title}" 추가했어요`);
  return true;
}
function autoGrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }

// ---------- 날짜 시트 ----------
let dateDraft = null;
let dpMonth = null;
function dateSheetHTML() {
  const x = dateDraft;
  const t = todayStr();
  const [y, m] = dpMonth.split('-').map(Number);
  const ws = S().weekStart || 0;
  const lead = (new Date(y, m - 1, 1).getDay() - ws + 7) % 7;
  const start = addDays(`${dpMonth}-01`, -lead);
  const heads = Array.from({ length: 7 }, (_, i) => { const wd = (ws + i) % 7; return `<span class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">${WEEKDAYS[wd]}</span>`; }).join('');
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const inr = x.endDate && x.date && d > x.date && d < x.endDate;
    cells += `<button class="m-dp-d${d.slice(0, 7) !== dpMonth ? ' out' : ''}${d === t ? ' today' : ''}${d === x.date || d === x.endDate ? ' on' : ''}${inr ? ' in' : ''}${holidayOf(d) || parseYmd(d).getDay() === 0 ? ' sun' : ''}" data-a="dp-pick" data-d="${d}">${parseYmd(d).getDate()}</button>`;
  }
  const quick = [['today', 'sun', '오늘'], ['tomorrow', 'sunrise', '내일'], ['week', 'plus7', '다음 주'], ['none', 'nodate', '날짜 없음']];
  return `<div class="m-dp">
    <div class="m-dp-quick">${quick.map(([k, ic, l]) => `<button data-a="dp-quick" data-k="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
    <div class="m-dp-mh"><b>${y}년 ${m}월</b><span class="flex1"></span><button data-a="dp-month" data-dir="-1">${icon('chevL')}</button><button data-a="dp-month" data-dir="0" class="m-pill sm">오늘</button><button data-a="dp-month" data-dir="1">${icon('chevR')}</button></div>
    <div class="m-dp-wd">${heads}</div>
    <div class="m-dp-grid">${cells}</div>
    <div class="m-dp-mode"><button class="${x.rangeMode ? '' : 'on'}" data-a="dp-range" data-v="0">하루</button><button class="${x.rangeMode ? 'on' : ''}" data-a="dp-range" data-v="1">여러 날 (기간)</button></div>
    ${x.rangeMode ? `<p class="m-dp-hint">${x.endDate ? `${shortMd(x.date)} – ${shortMd(x.endDate)} · ${diffDays(x.endDate, x.date) + 1}일` : '끝나는 날을 눌러 주세요'}</p>` : ''}
    <div class="m-dp-rows">
      <label class="m-dp-row">${icon('clock')}<span>시간</span><span class="flex1"></span>
        <input type="time" id="dpTime" value="${x.time || ''}" ${x.date ? '' : 'disabled'}>
        ${x.time ? `<button class="m-x" data-a="dp-clear-time" aria-label="시간 지우기">${icon('x')}</button>` : ''}</label>
      ${x.time ? `<label class="m-dp-row sub"><span>끝나는 시각</span><span class="flex1"></span><input type="time" id="dpEnd" value="${x.endTime || ''}">${x.endTime ? `<button class="m-x" data-a="dp-clear-end" aria-label="끝 시각 지우기">${icon('x')}</button>` : ''}</label>` : ''}
      <label class="m-dp-row">${icon('bell')}<span>알림</span><span class="flex1"></span>
        <select id="dpRemind" ${x.date ? '' : 'disabled'}>${REMINDS.map((r) => `<option value="${r.v}" ${String(x.remind ?? '') === r.v ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
      <label class="m-dp-row">${icon('repeat')}<span>반복</span><span class="flex1"></span>
        <select id="dpRepeat" ${x.date ? '' : 'disabled'}>${REPEATS.map((r) => `<option value="${r.v}" ${x.repeat === r.v ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
    </div>
    <div class="m-dp-foot"><button class="m-btn" data-a="dp-cancel">취소</button><button class="m-btn primary" data-a="dp-ok">확인</button></div>
  </div>`;
}
function openDateSheet() {
  const d = taskSheet.d;
  dateDraft = { date: d.date, endDate: d.endDate, time: d.time, endTime: d.endTime, remind: d.remind, repeat: d.repeat || 'none', rangeMode: !!(d.endDate && d.endDate > d.date) };
  dpMonth = (d.date || todayStr()).slice(0, 7);
  openSheet(dateSheetHTML(), { cls: 'date' });
}
function refreshDateSheet() { const sh = topSheet(); if (sh && sh.el.classList.contains('date')) rerenderSheet(sh, dateSheetHTML()); }
function applyDate(x) {
  if (!x.date) Object.assign(x, { endDate: null, time: null, endTime: null, remind: null, repeat: 'none' });
  if (x.endDate && x.endDate <= x.date) x.endDate = null;
  const tmp = { dueDate: x.date, endDate: x.endDate, dueTime: x.time, endTime: x.endTime };
  fixEndTime(tmp);
  x.endTime = tmp.endTime;
  Object.assign(taskSheet.d, { date: x.date, endDate: x.endDate, time: x.time, endTime: x.endTime, remind: x.remind, repeat: x.repeat });
  closeSheet({ silent: true });
  applyEdit();
  refreshTaskSheet();
}

// ---------- 고르기 시트 (우선순위 · 목록 추가 등) ----------
function openPickSheet(title, items, onPick) {
  openSheet(`<div class="m-pick"><h3>${title}</h3>${items.map((it, i) => `<button class="m-pick-i ${it.on ? 'on' : ''}" data-a="pick" data-i="${i}">${it.html}${it.on ? icon('check', 'tick') : ''}</button>`).join('')}</div>`, { cls: 'pick' });
  pickHandler = (i) => { closeSheet({ silent: true }); onPick(items[i]); };
}
let pickHandler = null;

// ---------- 디데이 시트 ----------
let ddDraft = null;
function ddSheetHTML() {
  const x = ddDraft;
  const info = x.date ? ddayInfo(x.date, x.style) : null;
  return `<div class="m-ddsheet">
    <h3>${x.id ? '디데이 고치기' : '디데이 추가'}</h3>
    <input id="ddTitle" class="m-input" placeholder="이름 (예: 시험, 여행, 생일)" value="${esc(x.title)}" autocomplete="off" enterkeyhint="done">
    <label class="m-dp-row">${icon('calendar')}<span>날짜</span><span class="flex1"></span><input type="date" id="ddDate" value="${x.date}"></label>
    <div class="m-dp-row m-dd-style">${icon('dday')}<span>지난 날</span><span class="flex1"></span><div class="m-seg">${DDAY_STYLES.map((o) => `<button class="${x.style === o.v ? 'on' : ''}" data-a="dd-style" data-v="${o.v}">${o.label}</button>`).join('')}</div></div>
    <div class="m-swatches"><button class="m-sw list ${x.color ? '' : 'on'}" style="--c:${esc(ddColor(null))}" data-a="dd-color" data-v="">기본</button>${PRESET_COLORS.map((c) => `<button class="m-sw ${x.color === c ? 'on' : ''}" style="--c:${c}" data-a="dd-color" data-v="${c}"></button>`).join('')}</div>
    ${info ? `<div class="m-dd-prev" style="--c:${esc(x.color || ddColor(null))}"><b>${info.label}</b><span>${info.sub}</span></div>` : ''}
    <div class="m-dp-foot">${x.id ? `<button class="m-btn danger" data-a="dd-delete">${icon('trash')}삭제</button>` : '<button class="m-btn" data-a="dd-cancel">취소</button>'}<button class="m-btn primary" data-a="dd-save">${x.id ? '저장' : '추가'}</button></div>
  </div>`;
}
function openDdaySheet(x) {
  if (!canEdit()) return;
  ddDraft = x ? { id: x.id, title: x.title, date: x.date, color: x.color || null, style: x.style === 'plus' ? 'plus' : 'nth' } : { id: null, title: '', date: addDays(todayStr(), 30), color: null, style: 'plus' };
  openSheet(ddSheetHTML(), { cls: 'ddsheet', onMount: (el) => { if (!x) setTimeout(() => $('#ddTitle', el).focus(), 60); } });
}
function refreshDdSheet() {
  const sh = topSheet();
  if (!sh || !sh.el.classList.contains('ddsheet')) return;
  ddDraft.title = $('#ddTitle').value;
  rerenderSheet(sh, ddSheetHTML());
}

// =====================================================================
// 이벤트
// =====================================================================
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  const id = el.dataset.id;
  switch (a) {
    case 'tab':
      if (state.tab === el.dataset.k && el.closest('.m-tabs')) { state.listView = null; $('#view').scrollTo({ top: 0, behavior: 'smooth' }); }
      state.tab = el.dataset.k;
      if (state.tab !== 'lists') state.listView = null;
      render();
      break;
    case 'fab':
      if (state.tab === 'dday') openDdaySheet(null);
      else if (state.tab === 'calendar') openTaskSheet('add', { date: state.calSel });
      else if (state.tab === 'lists' && state.listView && state.listView.startsWith('list:')) openTaskSheet('add', { listId: state.listView.slice(5) });
      else if (state.tab === 'lists' && state.listView === 'next7') openTaskSheet('add', { date: todayStr() });
      else if (state.tab === 'lists') openTaskSheet('add', {});
      else openTaskSheet('add', { date: todayStr() });
      break;
    case 'toggle': e.stopPropagation(); toggleDone(id); break;
    case 'ph-open': openPhotos(el.dataset.d, id); break;
    case 'ph-add': { const d = el.dataset.d; if (photoReady()) Photos.pickFiles((files) => addPhotos(d, files)); break; }
    case 'open-task': openTaskSheet('edit', { id }); break;
    case 'sec': {
      const k = el.dataset.k;
      const def = el.dataset.def === '1';
      const open = state.showDone[k] === undefined ? !def : state.showDone[k];
      state.showDone[k] = !open;
      render();
      break;
    }
    // 캘린더
    case 'cal-day':
      state.calSel = el.dataset.d;
      if (state.calSel.slice(0, 7) !== state.calMonth) state.calMonth = state.calSel.slice(0, 7);
      render();
      break;
    case 'cal-move': moveMonth(Number(el.dataset.dir)); break;
    case 'cal-today': state.calMonth = todayStr().slice(0, 7); state.calSel = todayStr(); render(); break;
    // 목록
    case 'list-open': state.listView = el.dataset.k; render(); $('#view').scrollTop = 0; break;
    case 'list-back': state.listView = null; render(); break;
    case 'list-add': {
      if (!canEdit()) break;
      const name = (prompt('새 목록 이름') || '').trim();
      if (!name) break;
      state.data.lists.push({ id: uid(), name, color: PRESET_COLORS[state.data.lists.length % PRESET_COLORS.length] });
      commit();
      break;
    }
    // 디데이
    case 'dd-open': openDdaySheet(state.data.ddays.find((x) => x.id === id)); break;
    case 'dd-color': ddDraft.color = el.dataset.v || null; refreshDdSheet(); break;
    case 'dd-style': ddDraft.style = el.dataset.v; ddDraft.date = $('#ddDate').value || ddDraft.date; refreshDdSheet(); break;
    case 'dd-cancel': closeSheet(); break;
    case 'dd-save': {
      const title = $('#ddTitle').value.trim();
      const date = $('#ddDate').value;
      if (!title) { toast('이름을 적어 주세요'); $('#ddTitle').focus(); break; }
      if (!date) { toast('날짜를 골라 주세요'); break; }
      if (ddDraft.id) Object.assign(state.data.ddays.find((x) => x.id === ddDraft.id) || {}, { title, date, color: ddDraft.color, style: ddDraft.style });
      else state.data.ddays.push({ id: uid(), title, date, color: ddDraft.color, style: ddDraft.style, pinned: false });
      closeSheet({ silent: true });
      commit();
      toast(`"${title}" ${ddayInfo(date, ddDraft.style).label}`);
      break;
    }
    case 'dd-delete': {
      const x = state.data.ddays.find((y) => y.id === ddDraft.id);
      closeSheet({ silent: true });
      if (x) withUndo(`"${x.title}" 디데이를 지웠어요`, () => { state.data.ddays = state.data.ddays.filter((y) => y !== x); });
      break;
    }
    // 설정
    case 'set': {
      const k = el.dataset.k;
      let v = el.dataset.v;
      if (k === 'weekStart') v = Number(v);
      if (k === 'showHolidays') v = v === 'true';
      S()[k] = v;
      applyTheme();
      commit();
      break;
    }
    case 'resync': if (Cloud.isActive()) { Cloud.resync(); toast('서버와 다시 맞추는 중이에요'); } else startCloud(); break;
    case 'logout':
      if (!confirm('로그아웃할까요? 이 폰에 저장된 일정 사본도 지워져요.')) break;
      Cloud.signOut().then(() => { try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* 무시 */ } state.data = null; widgetSignedOut(); loginScreen(); });
      break;
    case 'go-login': location.href = location.pathname; break;
    // 시트
    case 'sheet-close': closeSheet(); break;
    case 'pick': if (pickHandler) pickHandler(Number(el.dataset.i)); break;
    case 'ts-save': { const ok = saveNewTask(taskSheet); if (ok) { closeSheet({ silent: true }); taskSheet = null; } else $('#tsTitle').focus(); break; }
    case 'ts-date': openDateSheet(); break;
    case 'ts-prio':
      openPickSheet('우선순위', PRIORITY.map((p) => ({ v: p.v, on: taskSheet.d.priority === p.v, html: `<span class="m-flag p${p.v}">${icon('flag')}</span><span>${p.v ? `${p.label} 우선순위` : '우선순위 없음'}</span>` })), (it) => { taskSheet.d.priority = it.v; applyEdit(); refreshTaskSheet(); });
      break;
    case 'ts-colors': taskSheet.colorsOpen = !taskSheet.colorsOpen; refreshTaskSheet(); break;
    case 'ts-color': taskSheet.color = el.dataset.v || null; applyEdit(); refreshTaskSheet(); break;
    case 'ts-done': {
      const tid = taskSheet.id;
      toggleDone(tid);
      const t = taskById(tid);
      if (t) Object.assign(taskSheet.d, { date: t.dueDate, endDate: t.endDate, time: t.dueTime, endTime: t.endTime || null });
      refreshTaskSheet();
      break;
    }
    case 'ts-sub': {
      const t = taskById(taskSheet.id);
      const s = t && t.subtasks.find((x) => x.id === el.dataset.sub);
      if (s) { s.done = !s.done; commit(); refreshTaskSheet(); }
      break;
    }
    case 'ts-delete': { const tid = taskSheet.id; closeSheet({ silent: true }); taskSheet = null; deleteTask(tid); break; }
    // 날짜 시트
    case 'dp-quick': {
      const t = todayStr();
      const k = el.dataset.k;
      const x = dateDraft;
      x.endDate = null;
      if (k === 'today') x.date = t; else if (k === 'tomorrow') x.date = addDays(t, 1); else if (k === 'week') x.date = addDays(t, 7); else x.date = null;
      applyDate(x);
      break;
    }
    case 'dp-month': {
      const dir = Number(el.dataset.dir);
      if (!dir) dpMonth = todayStr().slice(0, 7);
      else { const [y, m] = dpMonth.split('-').map(Number); const n = new Date(y, m - 1 + dir, 1); dpMonth = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; }
      refreshDateSheet();
      break;
    }
    case 'dp-pick': {
      const d = el.dataset.d;
      const x = dateDraft;
      if (x.rangeMode && x.date && !x.endDate && d > x.date) x.endDate = d;
      else { x.date = d; x.endDate = null; }
      if (d.slice(0, 7) !== dpMonth) dpMonth = d.slice(0, 7);
      refreshDateSheet();
      break;
    }
    case 'dp-range': dateDraft.rangeMode = el.dataset.v === '1'; if (!dateDraft.rangeMode) dateDraft.endDate = null; if (dateDraft.rangeMode && !dateDraft.date) dateDraft.date = todayStr(); refreshDateSheet(); break;
    case 'dp-clear-time': dateDraft.time = null; dateDraft.endTime = null; refreshDateSheet(); break;
    case 'dp-clear-end': dateDraft.endTime = null; refreshDateSheet(); break;
    case 'dp-cancel': closeSheet({ silent: true }); break;
    case 'dp-ok': applyDate(dateDraft); break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'tsTitle' || t.id === 'tsNotes') {
    autoGrow(t);
    if (taskSheet && taskSheet.mode === 'edit') {
      const task = taskById(taskSheet.id);
      if (task) { if (t.id === 'tsTitle') task.title = t.value.replace(/\n/g, ' '); else task.notes = t.value; save(); }
    }
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'tsList' && taskSheet) { taskSheet.d.listId = t.value; applyEdit(); refreshTaskSheet(); return; }
  if (!dateDraft) return;
  if (t.id === 'dpTime') { const old = dateDraft.time; dateDraft.time = t.value || null; if (!dateDraft.time) dateDraft.endTime = null; else if (old && dateDraft.endTime) dateDraft.endTime = hmStr(clamp(hm(dateDraft.endTime) + hm(dateDraft.time) - hm(old), 0, 23 * 60 + 59)); refreshDateSheet(); }
  if (t.id === 'dpEnd') { dateDraft.endTime = t.value || null; if (dateDraft.endTime && hm(dateDraft.endTime) <= hm(dateDraft.time) && !dateDraft.endDate) { toast('끝나는 시각은 시작보다 뒤여야 해요'); dateDraft.endTime = null; } refreshDateSheet(); }
  if (t.id === 'dpRemind') dateDraft.remind = t.value === '' ? null : Number(t.value);
  if (t.id === 'dpRepeat') dateDraft.repeat = t.value;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && e.target.id === 'tsTitle') {
    e.preventDefault();
    if (taskSheet && taskSheet.mode === 'add') { if (saveNewTask(taskSheet)) { closeSheet({ silent: true }); taskSheet = null; } } else closeSheet();
  }
  if (e.key === 'Enter' && !e.isComposing && e.target.id === 'ddTitle') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape' && sheets.length) closeSheet({ discard: true });
});

// 캘린더: 옆으로 밀어서 달 넘기기
function moveMonth(dir) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const n = new Date(y, m - 1 + dir, 1);
  state.calMonth = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
  const t = todayStr();
  state.calSel = t.slice(0, 7) === state.calMonth ? t : `${state.calMonth}-01`;
  render();
  const g = $('.m-cal-grid');
  if (g) { g.classList.add(dir > 0 ? 'from-r' : 'from-l'); }
}
let sw = null;
document.addEventListener('touchstart', (e) => { const c = e.target.closest('#mCal'); sw = c ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!sw) return;
  const dx = e.changedTouches[0].clientX - sw.x;
  const dy = e.changedTouches[0].clientY - sw.y;
  sw = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) moveMonth(dx < 0 ? 1 : -1);
});

// =====================================================================
// 로그인 화면
// =====================================================================
const authErr = (err) => {
  const m = String((err && (err.message || err.code)) || err);
  if (/invalid login|invalid_credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요';
  if (/email not confirmed/i.test(m)) return '메일 인증을 먼저 해 주세요 (받은 메일의 링크 또는 6자리 코드)';
  if (/already registered|user_already_exists/i.test(m)) return '이미 가입된 이메일이에요. 로그인해 주세요';
  if (/password.*(6|short)|weak/i.test(m)) return '비밀번호는 6자 이상으로 해 주세요';
  if (/rate|too many|security purposes/i.test(m)) return '잠시 뒤에 다시 시도해 주세요 (메일은 시간당 보낼 수 있는 수가 정해져 있어요)';
  if (/token|otp|expired/i.test(m)) return '코드가 맞지 않거나 만료됐어요';
  if (/fetch|network|failed/i.test(m)) return '인터넷 연결을 확인해 주세요';
  return m;
};
function loginScreen({ mode = 'login', email = '', error = '', info = '' } = {}) {
  state.data = null;
  applyTheme();
  const titles = { login: '로그인', signup: '회원가입', verify: '메일 인증', forgot: '비밀번호 찾기', reset: '메일 확인', newpw: '새 비밀번호' };
  const body = {
    login: `<input id="auEmail" class="m-input" type="email" placeholder="이메일" value="${esc(email)}" autocomplete="username" inputmode="email">
      <input id="auPw" class="m-input" type="password" placeholder="비밀번호" autocomplete="current-password" enterkeyhint="go">
      <button class="m-btn primary big" data-au="login">로그인</button>
      <div class="m-au-links"><button data-au="to-signup">회원가입</button><button data-au="to-forgot">비밀번호를 잊었어요</button></div>`,
    signup: `<input id="auEmail" class="m-input" type="email" placeholder="이메일" value="${esc(email)}" autocomplete="username" inputmode="email">
      <input id="auPw" class="m-input" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="new-password">
      <input id="auPw2" class="m-input" type="password" placeholder="비밀번호 확인" autocomplete="new-password" enterkeyhint="go">
      <button class="m-btn primary big" data-au="signup">가입하고 인증 메일 받기</button>
      <div class="m-au-links"><button data-au="to-login">이미 계정이 있어요</button></div>`,
    verify: `<p class="m-au-p"><b>${esc(email)}</b> 로 인증 메일을 보냈어요. 메일의 <b>링크</b>를 누르거나, 메일에 있는 <b>6자리 코드</b>를 넣어 주세요.</p>
      <input id="auCode" class="m-input code" inputmode="numeric" maxlength="8" placeholder="인증 코드" autocomplete="one-time-code">
      <button class="m-btn primary big" data-au="verify">확인</button>
      <div class="m-au-links"><button data-au="resend">메일 다시 보내기</button><button data-au="to-login">로그인으로</button></div>`,
    forgot: `<input id="auEmail" class="m-input" type="email" placeholder="가입한 이메일" value="${esc(email)}" inputmode="email">
      <button class="m-btn primary big" data-au="forgot">재설정 메일 보내기</button>
      <div class="m-au-links"><button data-au="to-login">로그인으로</button></div>`,
    reset: `<p class="m-au-p"><b>${esc(email)}</b> 로 비밀번호 재설정 메일을 보냈어요. 메일의 링크를 이 폰에서 누르거나, 6자리 코드를 넣어 주세요.</p>
      <input id="auCode" class="m-input code" inputmode="numeric" maxlength="8" placeholder="재설정 코드" autocomplete="one-time-code">
      <button class="m-btn primary big" data-au="reset-code">확인</button>
      <div class="m-au-links"><button data-au="to-login">로그인으로</button></div>`,
    newpw: `<input id="auPw" class="m-input" type="password" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password">
      <input id="auPw2" class="m-input" type="password" placeholder="새 비밀번호 확인" autocomplete="new-password">
      <button class="m-btn primary big" data-au="newpw">비밀번호 바꾸기</button>`,
  }[mode];
  $('#app').innerHTML = `<div class="m-auth">
    <div class="m-logo">${icon('check')}</div>
    <h1>HaruPlanner</h1>
    <p class="m-au-sub">${mode === 'login' ? '데스크톱과 같은 계정으로 로그인하면<br>일정이 실시간으로 맞춰져요' : titles[mode]}</p>
    ${error ? `<p class="m-au-err">${esc(error)}</p>` : ''}${info ? `<p class="m-au-info">${esc(info)}</p>` : ''}
    <div class="m-au-form" data-mode="${mode}" data-email="${esc(email)}">${body}</div>
    <a class="m-au-demo" href="?demo">로그인 없이 둘러보기</a>
  </div>`;
  const first = $('.m-au-form input');
  if (first && !email) setTimeout(() => first.focus(), 50);
}
async function authAction(kind, form) {
  const email = ($('#auEmail') && $('#auEmail').value.trim()) || form.dataset.email || '';
  const pw = $('#auPw') ? $('#auPw').value : '';
  const busy = form.querySelector('.m-btn.primary');
  if (busy) { busy.disabled = true; busy.textContent = '잠시만요…'; }
  try {
    if (kind === 'login') { await Cloud.signIn(email, pw); await startCloud(); return; }
    if (kind === 'signup') {
      if (pw !== $('#auPw2').value) throw new Error('비밀번호 두 개가 서로 달라요');
      const r = await Cloud.signUp(email, pw);
      if (r.needsConfirm) loginScreen({ mode: 'verify', email }); else await startCloud();
      return;
    }
    if (kind === 'verify') { await Cloud.verifyCode(email, $('#auCode').value, 'signup'); await startCloud(); return; }
    if (kind === 'resend') { await Cloud.resendSignup(email); loginScreen({ mode: 'verify', email, info: '메일을 다시 보냈어요' }); return; }
    if (kind === 'forgot') { await Cloud.sendReset(email); loginScreen({ mode: 'reset', email }); return; }
    if (kind === 'reset-code') { await Cloud.verifyCode(email, $('#auCode').value, 'recovery'); loginScreen({ mode: 'newpw', email }); return; }
    if (kind === 'newpw') {
      if (pw.length < 6) throw new Error('password too short');
      if (pw !== $('#auPw2').value) throw new Error('비밀번호 두 개가 서로 달라요');
      await Cloud.updatePassword(pw);
      toast('비밀번호를 바꿨어요');
      await startCloud();
    }
  } catch (err) {
    loginScreen({ mode: form.dataset.mode, email, error: authErr(err) });
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-au]');
  if (!b) return;
  const form = b.closest('.m-au-form');
  const k = b.dataset.au;
  const email = ($('#auEmail') && $('#auEmail').value.trim()) || (form && form.dataset.email) || '';
  if (k.startsWith('to-')) { loginScreen({ mode: k.slice(3), email }); return; }
  authAction(k, form);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const form = e.target.closest && e.target.closest('.m-au-form');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('.m-btn.primary');
  if (btn) btn.click();
});

// =====================================================================
// 시작
// =====================================================================
function loading(text = '일정을 불러오는 중…') {
  $('#app').innerHTML = `<div class="m-loading"><div class="m-logo pulse">${icon('check')}</div><p>${text}</p></div>`;
}
function onRemote() {
  render();
  Photos.refreshViewer();
  saveCacheSoon();
  if (taskSheet && taskSheet.mode === 'edit' && !taskById(taskSheet.id)) { closeSheet({ silent: true }); taskSheet = null; toast('다른 기기에서 이 할 일을 지웠어요'); }
}
async function startCloud() {
  loading();
  let rows;
  try {
    rows = await Cloud.fetchAll();
  } catch (err) {
    const cached = loadCache();
    if (cached) {
      state.data = cached;
      state.offline = true;
      applyTheme();
      render();
      toast('인터넷에 연결되지 않아서 마지막으로 받은 일정을 보여줘요');
      return;
    }
    $('#app').innerHTML = `<div class="m-loading"><p>일정을 불러오지 못했어요<br><small>${esc(authErr(err))}</small></p><button class="m-btn primary" data-a="retry-boot">다시 시도</button></div>`;
    return;
  }
  state.offline = false;
  state.data = normalize(Cloud.buildData(rows, defaultData()));
  Cloud.start(rows, () => state.data, onRemote);
  applyTheme();
  render();
  saveCacheSoon();
  widgetInbox();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-a="retry-boot"]')) startCloud(); });
Cloud.onStatus(() => { if (state.data) { const s = $('.m-sync'); if (s) s.outerHTML = syncDot(); if (state.tab === 'settings') render(); } });

// 앱을 다시 볼 때(백그라운드 → 앞으로) 서버와 맞춰요. 폰은 백그라운드에서 실시간 연결이 끊기기 쉬워요.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || DEMO) return;
  if (state.offline) { startCloud(); return; }
  if (Cloud.isActive()) Cloud.resync();
  if (state.data) render(); // 날짜가 바뀌었을 수도 있어요
});
window.addEventListener('online', () => { if (state.offline) startCloud(); });
window.addEventListener('pagehide', () => { if (Cloud.isActive()) Cloud.flushNow(1500); });

function demoData() {
  const t = todayStr();
  const d = defaultData();
  const [personal, work] = [d.lists[1], d.lists[2]];
  d.tasks = [
    makeTask({ title: '일본어 스터디', dueDate: t, dueTime: '17:00', endTime: '20:00', listId: personal.id, priority: 3, notes: '세종청년센터' }),
    makeTask({ title: '운동 30분', dueDate: t, dueTime: '07:30', repeat: 'daily', listId: personal.id, priority: 1 }),
    makeTask({ title: '주간 보고서 작성', dueDate: addDays(t, 1), dueTime: '10:00', listId: work.id, priority: 2 }),
    makeTask({ title: '카드뉴스 제작', dueDate: addDays(t, -1), listId: work.id, color: '#ff9b73' }),
    makeTask({ title: '여행 준비', dueDate: addDays(t, 3), endDate: addDays(t, 5), listId: personal.id, color: '#7fb8ff' }),
    makeTask({ title: '장보기', dueDate: t, done: true, doneAt: Date.now() }),
    makeTask({ title: '책 읽기', listId: personal.id }),
  ];
  d.ddays = [{ id: uid(), title: 'JLPT N3', date: addDays(t, 21), color: null, pinned: true }, { id: uid(), title: '크리스마스', date: `${t.slice(0, 4)}-12-25` < t ? `${Number(t.slice(0, 4)) + 1}-12-25` : `${t.slice(0, 4)}-12-25`, color: '#ff6b81', pinned: false }];
  return d;
}

// ---------- 업데이트 알림 ----------
// 1) 웹 앱: 새로 올리면 서비스 워커가 새 파일을 받아 두고 → "새 버전이 있어요" 를 띄워요
// 2) 안드로이드 앱(APK): 앱 껍데기 버전이 낮으면 새 APK 를 받으라고 알려요
const ANDROID_APP = /HaruPlannerAndroid\/(\d+)\.(\d+)\.(\d+)/.exec(navigator.userAgent);
const isAndroid = /Android/i.test(navigator.userAgent);
function setupUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const check = () => reg.update().catch(() => {});
    setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(() => {});
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return; // 처음 설치할 땐 알리지 않아요
    shown = true;
    toast('HaruPlanner 새 버전이 있어요', { action: '업데이트', timeout: 30000, onAction: () => location.reload() });
  });
  checkApk();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkApk(); });
}
let apkInfo = null;
let apkNotified = false;
async function checkApk() {
  if (!isAndroid) return;
  try {
    const r = await fetch(`app-version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    apkInfo = (await r.json()).android || null;
  } catch (_) { return; }
  if (!apkInfo || !ANDROID_APP || apkNotified) return;
  const mine = Number(ANDROID_APP[1]) * 10000 + Number(ANDROID_APP[2]) * 100 + Number(ANDROID_APP[3]);
  if (apkInfo.versionCode > mine) {
    apkNotified = true;
    toast(`안드로이드 앱 새 버전 ${apkInfo.version} 이 나왔어요`, { action: '받기', timeout: 30000, onAction: () => { location.href = apkInfo.apk; } });
  }
}

// ---------- 안드로이드 홈 화면 위젯 (APK 1.1.0 부터) ----------
// 앱이 앞으로 7일치 할 일과 테마 색을 위젯에 넘겨요. 위젯에서 체크한 건 앱을 열 때 여기서 진짜로 저장해요.
const HaruWidget = (() => {
  const C = window.Capacitor;
  if (!C || !ANDROID_APP) return null;
  const has = (C.isPluginAvailable && C.isPluginAvailable('HaruWidget')) || (Array.isArray(C.PluginHeaders) && C.PluginHeaders.some((h) => h.name === 'HaruWidget'));
  if (!has) return null; // 위젯이 없는 예전 APK
  const call = (method, opts = {}) => {
    const p = C.Plugins && C.Plugins.HaruWidget;
    if (p && typeof p[method] === 'function') return p[method](opts);
    if (typeof C.nativePromise === 'function') return C.nativePromise('HaruWidget', method, opts);
    return Promise.reject(new Error('no bridge'));
  };
  return { update: (o) => call('update', o), takePending: () => call('takePending') };
})();
let widgetLast = '';
let widgetT = 0;
function widgetPayload() {
  const t = todayStr();
  const lim = addDays(t, 7);
  const v = themeVars(S().accent || DEFAULT_ACCENT, document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : v.accent);
  const items = state.data.tasks
    .filter((x) => x.dueDate && x.dueDate <= lim && !(x.done && taskEnd(x) < t))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .slice(0, 150)
    .map((x) => ({ id: x.id, title: x.title, date: x.dueDate, end: taskEnd(x), hm: x.dueTime || '', time: x.dueTime ? timeLabel(x.dueTime) : '', done: !!x.done, prio: x.priority || 0, color: hex(taskColor(x)) }));
  return { signedIn: true, items, theme: { panel: v.panel, text: v.text, sub: v['text-2'], faint: v['text-3'], accent: v.accent } };
}
function syncWidget() {
  if (!HaruWidget || DEMO) return;
  clearTimeout(widgetT);
  widgetT = setTimeout(() => {
    if (!state.data) return;
    let json;
    try { json = JSON.stringify(widgetPayload()); } catch (_) { return; }
    if (json === widgetLast) return;
    widgetLast = json;
    HaruWidget.update({ json }).catch(() => { widgetLast = ''; });
  }, 500);
}
function widgetSignedOut() { // 로그아웃하면 위젯에서도 할 일을 지워요
  if (!HaruWidget) return;
  widgetLast = '';
  HaruWidget.update({ json: JSON.stringify({ signedIn: false, items: [] }) }).catch(() => {});
}
async function widgetInbox() {
  if (!HaruWidget || DEMO || !state.data || state.offline) return;
  let r;
  try { r = await HaruWidget.takePending(); } catch (_) { return; }
  let toggles = {};
  try { toggles = JSON.parse((r && r.toggles) || '{}'); } catch (_) { toggles = {}; }
  for (const [id, done] of Object.entries(toggles)) { const x = taskById(id); if (x && !!x.done !== !!done) toggleDone(id); }
  const a = (r && r.action) || '';
  if (a) { state.tab = a === 'calendar' ? 'calendar' : 'today'; state.listView = null; render(); }
  if (a === 'add') openTaskSheet('add', { date: todayStr() });
  else if (a.startsWith('open:') && taskById(a.slice(5))) openTaskSheet('edit', { id: a.slice(5) });
  widgetLast = '';
  syncWidget();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(widgetInbox, 250); });

async function boot() {
  applyTheme();
  setupUpdates();
  if (DEMO) { state.data = normalize(demoData()); applyTheme(); render(); return; }
  const cfg = Cloud.config();
  if (!cfg) { $('#app').innerHTML = '<div class="m-loading"><p>클라우드 설정(config.js)이 없어요</p></div>'; return; }
  try { Cloud.connect(cfg.url, cfg.key); } catch (err) { $('#app').innerHTML = `<div class="m-loading"><p>${esc(err.message)}</p></div>`; return; }
  // 메일 링크(가입 인증 · 비밀번호 재설정)로 열렸을 때
  if (/[?&]code=|error_description=/.test(location.search + location.hash)) {
    const r = await Cloud.handleAuthUrl(location.href);
    history.replaceState(null, '', location.pathname);
    if (!r.ok) { loginScreen({ error: r.error }); return; }
    if (r.recovery) { loginScreen({ mode: 'newpw' }); return; }
    toast('메일 인증이 끝났어요');
  }
  loading('로그인 확인 중…');
  let user = null;
  try { user = await Cloud.currentUser(); } catch (_) { user = null; }
  if (!user) {
    const cached = loadCache();
    if (cached && !navigator.onLine) { state.data = cached; state.offline = true; applyTheme(); render(); return; }
    loginScreen();
    return;
  }
  await startCloud();
}
boot();
