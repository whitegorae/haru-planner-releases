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
  const size = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  const num = (n) => Number(n || 0).toLocaleString('ko-KR');
  const pct = (a, b) => Math.min(100, (a / b) * 100);

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
    return `<div class="dev ${cls}" id="devPanel">
      <div class="dev-h"><b>개발자 모드</b><span>이 계정에서만 보여요</span></div>
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
      </div>
      <p class="dev-note">전송량(Egress, 무료 5GB/월)은 서버 안에서 읽을 수 없어요 → Supabase 대시보드의 Usage 에서 확인해요.</p>
      <button class="dev-btn" data-dev="refresh">다시 읽기</button>
      <details class="dev-log"><summary>지금까지 업데이트 내역 전체 (${all.length}개 버전)</summary>
        ${all.map((v) => `<div class="dev-v"><b>${e(v.v)}</b><span>${e(v.date || '')}</span><ul>${v.items.map((s) => `<li>${e(s)}</li>`).join('')}</ul></div>`).join('')}
      </details>
    </div>`;
  }

  document.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('[data-dev="refresh"]')) load(true); });

  return { load, get, html, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); } };
})();
