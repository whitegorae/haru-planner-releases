'use strict';

/* =========================================================================
 * 개발자 모드 (데스크톱 · 폰 같이 써요)
 *  - 서버 함수 admin_usage() 가 "로그인한 계정이 관리자일 때만" 사용량을 돌려줘요 (supabase/admin.sql)
 *  - 앱에는 관리자 이메일이 없어요. 서버가 아무것도 안 돌려주면 개발자 모드는 아예 그리지 않아요.
 * ========================================================================= */

const DevMode = (() => {
  let data = null;
  let uid = null;
  let at = 0;
  let busy = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch (_) { /* 무시 */ } });
  // 펼치기 · 접기 (이 기기에 기억해요). 접혀 있으면 드라이브 · 사용자별 사용량은 읽지 않아요
  const OPEN_KEY = 'haru-devmode-open';
  let open = (() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (_) { return false; } })();
  function toggle() {
    open = !open;
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) { /* 무시 */ }
    emit();
    if (open && data && !data.people) load(true);
  }
  const me = () => (typeof Cloud !== 'undefined' && Cloud.isActive() && Cloud.user() ? Cloud.user().id : null);

  async function load(force = false) {
    const id = me();
    if (!id) { if (data) { data = null; uid = null; emit(); } return; }
    if (busy || (!force && uid === id && Date.now() - at < 60 * 1000)) return;
    busy = true;
    let d = null;
    try {
      const r = await Cloud.client().rpc('admin_usage');
      d = !r.error && r.data && typeof r.data === 'object' ? r.data : null;
    } catch (_) { d = null; }
    // 관리자일 때만: 구글 드라이브(원본 사진 · 백업 보관소) 사용량도 읽어요 (관리자 본인 드라이브)
    if (d && open && typeof HaruBackup !== 'undefined' && HaruBackup.driveUsage) {
      try { d = { ...d, drive: await HaruBackup.driveUsage() }; } catch (e) { d = { ...d, drive: { error: (e && e.message) || String(e) } }; }
    }
    // 사용자별 사용량: Supabase(계정 · 사진 저장소 · 할 일) + 드라이브(각자 연결한 드라이브)
    if (d && open) {
      const [sb, dr] = await Promise.all([
        Cloud.client().rpc('admin_users').then((r) => (!r.error && Array.isArray(r.data) ? r.data : null), () => null),
        typeof HaruBackup !== 'undefined' && HaruBackup.driveAdminUsage ? HaruBackup.driveAdminUsage().then((r) => (r && Array.isArray(r.users) ? r.users : null), () => null) : Promise.resolve(null),
      ]);
      d = { ...d, people: mergePeople(sb, dr) };
    }
    busy = false;
    at = Date.now();
    const changed = JSON.stringify(d) !== JSON.stringify(data) || uid !== id;
    data = d;
    uid = id;
    if (changed || force) emit();
  }
  // 다른 계정으로 바뀌면 바로 안 보이게
  const get = () => (data && uid && uid === me() ? data : null);

  const LIMITS = { db: 500 * 1024 * 1024, storage: 1024 * 1024 * 1024, mau: 50000, egress: 5 * 1024 * 1024 * 1024 };
  const size = (b) => (b >= 1099511627776 ? `${(b / 1099511627776).toFixed(2)} TB` : b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  const num = (n) => Number(n || 0).toLocaleString('ko-KR');
  const pct = (a, b) => Math.min(100, (a / b) * 100);

  // 사용자별로 합치기: Supabase 계정 목록(sb) + 드라이브 사용량(dr). 둘 중 하나만 있어도 보여줘요
  function mergePeople(sb, dr) {
    if (!sb && !dr) return null;
    const byId = new Map();
    for (const u of sb || []) byId.set(u.id, { id: u.id, email: u.email || '', created: u.created_at, last: u.last_sign_in_at, sbBytes: Number(u.storage_bytes) || 0, sbFiles: Number(u.storage_files) || 0, events: Number(u.events) || 0, meta: Number(u.meta) || 0, calAt: u.cal_at || null, workAt: u.work_at || null, dataAt: u.data_at || null, drive: null });
    for (const x of dr || []) {
      const p = byId.get(x.user_id) || { id: x.user_id, email: '', sbBytes: 0, sbFiles: 0, events: 0, meta: 0 };
      p.drive = x;
      byId.set(x.user_id, p);
    }
    const list = [...byId.values()].map((p) => ({ ...p, total: (p.drive && !p.drive.error ? Number(p.drive.bytes) || 0 : 0) + p.sbBytes }));
    list.sort((a, b) => b.total - a.total || String(a.email).localeCompare(String(b.email)));
    return { list, hasSb: !!sb, hasDrive: !!dr };
  }

  // 모든 사용자의 사용량: 사람마다 한 묶음 (많이 쓴 순서)
  function peopleHtml(pp, e) {
    if (!pp || !pp.list.length) return '';
    const allDrive = pp.list.reduce((s, p) => s + (p.drive && !p.drive.error ? Number(p.drive.bytes) || 0 : 0), 0);
    const allSb = pp.list.reduce((s, p) => s + p.sbBytes, 0);
    const ymdOf = (iso) => { if (!iso) return '-'; const t = new Date(iso); return `${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()}`; };
    // 마지막 수정: 날짜 + 시각 (+ 얼마 전)
    const whenOf = (iso) => {
      if (!iso) return '기록 없음';
      const t = new Date(iso);
      const p2 = (n) => String(n).padStart(2, '0');
      const min = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
      const ago = min < 1 ? '방금' : min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${Math.floor(min / 1440)}일 전`;
      return `${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()} ${p2(t.getHours())}:${p2(t.getMinutes())} (${ago})`;
    };
    const share = (b) => (allDrive > 0 ? pctText(b / allDrive) : '0%');
    const line = (label, x) => (x && x.n ? `<span>${label}</span><b>${num(x.n)}개 · ${size(Number(x.bytes) || 0)}</b>` : '');
    const one = (p) => {
      const dr = p.drive;
      const k = (dr && dr.kinds) || {};
      const driveRows = !dr
        ? '<span>하루플래너가 쓰는 양</span><b>드라이브 연결 안 함</b>'
        : dr.error
          ? `<span>하루플래너가 쓰는 양</span><b>${e(dr.error)}</b>`
          : `<span>하루플래너가 쓰는 양</span><b>${size(Number(dr.bytes) || 0)} · 전체 사용자 중 ${share(Number(dr.bytes) || 0)}</b>
            ${line('원본 사진', k.orig)}
            ${line('백업 (실시간 · 날짜별)', k.backups)}
            ${line('사진 백업 사본', k.photoCopies)}
            ${line('일정 첨부파일', k.attach)}
            ${line('기타', k.other)}`;
      return `<div class="dev-user">
        <div class="dev-user-h"><b>${e(p.email || '(이메일 없음)')}</b><span>가입 ${ymdOf(p.created)} · 최근 로그인 ${ymdOf(p.last)}</span></div>
        <div class="dev-grid">
          ${pp.hasSb ? `<span>캘린더(일정 · 할 일) 마지막 수정</span><b>${whenOf(p.calAt)}</b>
          <span>근무표 마지막 수정</span><b>${whenOf(p.workAt)}</b>
          <span>그 밖의 데이터 마지막 수정</span><b>${whenOf(p.dataAt)}</b>` : ''}
          ${driveRows}
          ${pp.hasSb ? `<span>Supabase 사진 저장소</span><b>${num(p.sbFiles)}개 · ${size(p.sbBytes)}</b>
          <span>할 일 · 일정 / 목록 · 설정</span><b>${num(p.events)}줄 / ${num(p.meta)}줄</b>` : ''}
          <span>연결한 계정</span><b>${dr && dr.email ? e(dr.email) : '-'}</b>
        </div>
      </div>`;
    };
    return `<p class="dev-sub dev-sub2">모든 사용자의 사용량 · ${num(pp.list.length)}명 (많이 쓴 순서)</p>
      <div class="dev-grid">
        <span>드라이브 합계 (하루플래너)</span><b>${size(allDrive)}</b>
        ${pp.hasSb ? `<span>Supabase 사진 저장소 합계</span><b>${size(allSb)}</b>` : ''}
      </div>
      ${pp.list.map(one).join('')}`;
  }
  // 아주 작은 비율은 0.000% 대신 "0.001% 미만"
  const pctText = (r) => { const p = r * 100; if (p <= 0) return '0%'; if (p < 0.001) return '0.001% 미만'; return `${p.toFixed(p < 0.1 ? 3 : p < 10 ? 1 : 0)}%`; };

  // 구글 드라이브: 원본 사진 · 백업을 보관하는 곳 (관리자 본인 드라이브 기준)
  function driveHtml(dr, bar, e) {
    if (!dr) return '';
    const head = '<p class="dev-sub dev-sub2">구글 드라이브 (원본 사진 · 백업 보관소) · 내 계정</p>';
    if (dr.error) {
      const msg = /연결되지 않았|연결이 풀렸/.test(dr.error) ? '이 계정은 구글 드라이브를 연결하지 않았어요 (설정 → 백업 · 원본 사진)' : /서버 준비/.test(dr.error) ? '드라이브 서버가 아직 준비되지 않았어요' : `드라이브 사용량을 읽지 못했어요: ${dr.error}`;
      return `${head}<p class="dev-note">${e(msg)}</p>`;
    }
    const k = dr.kinds || {};
    const q = dr.quota;
    const used = Number(dr.bytes) || 0;
    const line = (label, x) => (x && x.n ? `<span>${label}</span><b>${num(x.n)}개 · ${size(Number(x.bytes) || 0)}</b>` : '');
    return `${head}
      ${q && q.limit ? bar('드라이브 전체 (구글 계정 저장 공간)', Number(q.usage) || 0, Number(q.limit), size) : q ? `<div class="dev-grid"><span>드라이브 전체 사용량</span><b>${size(Number(q.usage) || 0)} (한도 없음)</b></div>` : ''}
      <div class="dev-grid">
        <span>하루플래너가 쓰는 양</span><b>${size(used)}${q && q.usage ? ` · 전체의 ${pctText(used / q.usage)}` : ''}</b>
        ${line('원본 사진', k.orig)}
        ${line('백업 (실시간 · 날짜별)', k.backups)}
        ${line('사진 백업 사본', k.photoCopies)}
        ${line('일정 첨부파일', k.attach)}
        ${line('기타', k.other)}
        ${dr.email ? `<span>연결한 계정</span><b>${e(dr.email)}</b>` : ''}
      </div>
      <p class="dev-note">하루플래너 파일은 드라이브의 숨김 앱 폴더에 있어서 드라이브 화면엔 안 보여요. 드라이브 → 설정 → 앱 관리 → HaruPlanner 에서도 용량을 볼 수 있어요.</p>`;
  }

  // 화면에 넣을 HTML (cls: 데스크톱 'pc' / 폰 'm')
  function html(cls) {
    const d = get();
    if (!d) return '';
    const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const bar = (label, used, limit, fmt) => {
      const p = pct(used, limit);
      return `<div class="dev-row"><div class="dev-row-h"><span>${label}</span><b>${fmt(used)} / ${fmt(limit)}</b></div>
        <div class="dev-bar ${p > 80 ? 'warn' : ''}"><i style="width:${p.toFixed(1)}%"></i></div>
        <small>남은 양 ${fmt(Math.max(0, limit - used))} · ${p.toFixed(1)}% 사용</small></div>`;
    };
    const t = new Date(d.at || Date.now());
    const all = (typeof CHANGELOG !== 'undefined' ? CHANGELOG : []);
    const head = `<button class="dev-h dev-toggle" data-dev="toggle" aria-expanded="${open}"><b>개발자 모드</b><span>이 계정에서만 보여요</span><i class="dev-chev ${open ? 'on' : ''}">›</i></button>`;
    if (!open) return `<div class="dev ${cls} closed" id="devPanel">${head}</div>`;
    return `<div class="dev ${cls}" id="devPanel">
      ${head}
      ${cls === 'pc' && typeof UiTweaks !== 'undefined' ? '<button class="dev-btn dev-ui-edit" data-dev="ui-edit">화면 고치기 모드 켜기</button><p class="dev-note">글자 · 상자를 눌러서 크기 · 여백 · 줄바꿈 · 글자를 1px 단위로 고쳐요. 캘린더 · 디데이 등 어느 화면에서든 <b>Ctrl+Shift+E</b> 로 켜고, "잠깐 앱 쓰기"로 화면을 옮겨 다녀요. 이 PC 화면에만 적용되고, "반영해줘"라고 하면 코드로 옮겨서 모두에게 내보내요.</p>' : ''}
      <p class="dev-sub">Supabase 무료 플랜 사용량 · ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} 기준</p>
      ${bar('데이터베이스', Number(d.db_bytes) || 0, LIMITS.db, size)}
      ${bar('파일 저장소 (사진)', Number(d.storage_bytes) || 0, LIMITS.storage, size)}
      ${bar('월간 활성 사용자 (30일)', Number(d.mau) || 0, LIMITS.mau, num)}
      <div class="dev-grid">
        <span>전체 가입자</span><b>${num(d.users)}명</b>
        <span>최근 30일 새 가입</span><b>${num(d.new_users_30d)}명</b>
        <span>할 일 · 일정 줄</span><b>${num(d.events)}</b>
        <span>목록 · 디데이 · 설정 줄</span><b>${num(d.meta)}</b>
        <span>사진 파일</span><b>${num(d.storage_files)}개</b>
        <span>구글 캘린더 연동</span><b>${num(d.gcal_links)}명</b>
        ${d.gdrive_links != null ? `<span>구글 드라이브 연결</span><b>${num(d.gdrive_links)}명</b>` : ''}
      </div>
      <p class="dev-note">전송량(Egress, 무료 5GB/월)은 서버 안에서 읽을 수 없어요 → Supabase 대시보드의 Usage 에서 확인해요.</p>
      ${driveHtml(d.drive, bar, e)}
      ${peopleHtml(d.people, e)}
      <button class="dev-btn" data-dev="refresh">다시 읽기</button>
      <details class="dev-log"><summary>지금까지 업데이트 내역 전체 (${all.length}개 버전)</summary>
        ${all.map((v) => `<div class="dev-v"><b>${e(v.v)}</b><span>${e(v.date || '')}${v.dev ? ' · 개발자만 업데이트' : ''}</span><ul>${v.items.map((s) => `<li>${e(s)}</li>`).join('')}</ul></div>`).join('')}
      </details>
    </div>`;
  }

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest) return;
    if (ev.target.closest('[data-dev="refresh"]')) load(true);
    else if (ev.target.closest('[data-dev="toggle"]')) toggle();
  });

  return { load, get, html, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); } };
})();
