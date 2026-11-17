'use strict';

/* =========================================================================
 * 사진 일기 (데스크톱 · 모바일 같이 써요)
 *  - 파일: Supabase Storage 'photos' 버킷 (비공개). 경로 <user id>/<YYYY-MM>/<id>.jpg (+ _t.jpg 작은 사진)
 *  - 목록: data.photos = [{ id, date, path, thumb, w, h, size, caption, createdAt }]  (cloud.js 가 planner_meta 로 동기화)
 *  - 올리기 전에 줄여요: 큰 사진 긴 쪽 1600px, 달력용 작은 사진 360px (무료 저장 공간 1GB 를 아껴요)
 *  - 보기: 7일짜리 서명 주소를 받아 이 기기에 기억해 둬요 (같은 주소라 브라우저 캐시가 그대로 쓰여요)
 * ========================================================================= */

const Photos = (() => {
  const BUCKET = 'photos';
  const URL_KEY = 'haru-photo-urls';
  const URL_TTL = 7 * 24 * 3600; // 초
  const FULL_SIDE = 1600;
  const THUMB_SIDE = 360;
  let urls = {};
  try { urls = JSON.parse(localStorage.getItem(URL_KEY)) || {}; } catch (_) { urls = {}; }
  const saveUrls = () => { try { localStorage.setItem(URL_KEY, JSON.stringify(urls)); } catch (_) { /* 용량 초과 등 */ } };
  const pending = new Set();
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const client = () => (typeof Cloud !== 'undefined' && Cloud.client && Cloud.client()) || null;
  const user = () => (typeof Cloud !== 'undefined' && Cloud.user && Cloud.user()) || null;
  const ready = () => !!(client() && user() && Cloud.isActive && Cloud.isActive());

  // ---------- 줄이기 ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(/heic|heif/i.test(file.type || file.name) ? '이 사진 형식(HEIC)은 이 기기에서 열 수 없어요. JPG 로 바꿔서 올려 주세요.' : '사진을 열 수 없어요')); };
      img.src = url;
    });
  }
  function toJpeg(img, maxSide, quality) {
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s));
    const h = Math.max(1, Math.round(img.naturalHeight * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h); // 요즘 브라우저는 사진의 회전 정보(EXIF)를 반영해서 그려요
    return new Promise((resolve) => c.toBlob((b) => resolve({ blob: b, w, h }), 'image/jpeg', quality));
  }

  // ---------- 올리기 / 지우기 ----------
  async function add(date, file) {
    if (!ready()) throw new Error('사진은 클라우드에 로그인한 상태에서 올릴 수 있어요');
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name || '')) throw new Error('사진 파일만 올릴 수 있어요');
    const { img, url } = await loadImage(file);
    try {
      const full = await toJpeg(img, FULL_SIDE, 0.82);
      const thumb = await toJpeg(img, THUMB_SIDE, 0.75);
      const id = newId();
      const base = `${user().id}/${date.slice(0, 7)}/${id}`;
      const st = client().storage.from(BUCKET);
      const opt = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
      // 작은 사진(달력 · 위젯용)은 Supabase 에
      const b = await st.upload(`${base}_t.jpg`, thumb.blob, opt);
      if (b.error) throw b.error;
      const meta = { id, date, path: '', thumb: `${base}_t.jpg`, w: full.w, h: full.h, size: full.blob.size + thumb.blob.size, caption: '', createdAt: Date.now() };
      // 원본은 구글 드라이브의 "HaruPlanner 원본 사진" 폴더에 (드라이브를 연결했고 하루플래너 열쇠가 있을 때)
      if (typeof HaruBackup !== 'undefined' && await HaruBackup.photoToDrive().catch(() => false)) {
        try {
          const f = await HaruBackup.drivePhotoPut(meta, new Uint8Array(await full.blob.arrayBuffer()));
          return { ...meta, drive: f.id };
        } catch (_) { /* 드라이브가 안 되면 지금처럼 Supabase 에 (나중에 자동으로 옮겨요) */ }
      }
      const a = await st.upload(`${base}.jpg`, full.blob, opt);
      if (a.error) { st.remove([`${base}_t.jpg`]).catch(() => {}); throw a.error; }
      return { ...meta, path: `${base}.jpg` };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function removeFiles(list) {
    const c = client();
    if (!c || !list || !list.length) return;
    const paths = list.flatMap((p) => [p.path, p.thumb]).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await c.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
    paths.forEach((p) => delete urls[p]);
    saveUrls();
    // 드라이브에 있는 원본도 지워요
    if (typeof HaruBackup !== 'undefined') for (const p of list) if (p && p.drive) await HaruBackup.drivePhotoDelete(p.drive).catch(() => {});
  }
  const errText = (e) => {
    const m = String((e && (e.message || e.error || e.statusCode)) || e);
    if (/bucket not found|not found.*bucket/i.test(m)) return '사진 저장소가 아직 없어요. supabase/schema.sql 의 5번(사진 일기)을 SQL Editor 에서 실행해 주세요.';
    if (/row-level security|unauthorized|403/i.test(m)) return '사진을 올릴 권한이 없어요. supabase/schema.sql 의 5번(사진 일기)을 실행했는지 확인해 주세요.';
    if (/payload too large|413|exceeded/i.test(m)) return '사진이 너무 커요';
    if (/fetch|network/i.test(m)) return '인터넷 연결을 확인해 주세요';
    return m;
  };

  // ---------- 보기 주소 ----------
  function cachedUrl(path) {
    const u = urls[path];
    return u && u.exp > Date.now() + 60 * 1000 ? u.url : null;
  }
  async function fetchUrls(paths) {
    const need = [...new Set(paths)].filter((p) => p && !cachedUrl(p) && !pending.has(p));
    if (!need.length || !client()) return;
    need.forEach((p) => pending.add(p));
    try {
      for (let i = 0; i < need.length; i += 100) {
        const part = need.slice(i, i + 100);
        const { data, error } = await client().storage.from(BUCKET).createSignedUrls(part, URL_TTL);
        if (error) throw error;
        for (const r of data || []) if (r.signedUrl && r.path) urls[r.path] = { url: r.signedUrl, exp: Date.now() + URL_TTL * 1000 };
      }
      saveUrls();
    } finally {
      need.forEach((p) => pending.delete(p));
    }
  }
  // 화면에 그려진 <img data-photo="경로"> 들에 주소를 채워요 (없으면 받아와서)
  async function hydrate(root = document) {
    const els = Array.from(root.querySelectorAll('img[data-photo]'));
    const fill = () => els.forEach((el) => { const u = cachedUrl(el.dataset.photo); if (u && el.getAttribute('src') !== u) el.src = u; });
    fill();
    const missing = els.map((el) => el.dataset.photo).filter((p) => !cachedUrl(p));
    if (!missing.length) return;
    try { await fetchUrls(missing); } catch (_) { /* 오프라인이면 다음에 */ }
    fill();
  }
  function clearCache() { urls = {}; try { localStorage.removeItem(URL_KEY); } catch (_) { /* 무시 */ } }
  function imgTag(path, cls = '', alt = '') {
    const u = cachedUrl(path);
    return `<img class="${cls}" data-photo="${String(path).replace(/"/g, '&quot;')}" ${u ? `src="${u}"` : ''} alt="${alt}" loading="lazy" decoding="async" draggable="false">`;
  }

  // ---------- 크게 보기 ----------
  // opts: { date, title, getList(), onAdd(files), onDelete(photo), onCaption(photo, text), startId }
  const CSS = `
  .pv{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;background:#0e0c12;color:#fff;font-family:var(--font-main,sans-serif);
    padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0);-webkit-user-select:none;user-select:none}
  @keyframes pvIn{from{opacity:0}}
  .pv-top{display:flex;align-items:center;gap:8px;padding:10px 12px;min-height:56px}
  .pv-top h3{margin:0;font-weight:normal;font-size:18px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pv-top small{opacity:.6;font-size:14px;margin-left:8px}
  .pv-b{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:none;border:0;color:#fff;cursor:pointer}
  .pv-b:hover,.pv-b:active{background:rgba(255,255,255,.12)}
  .pv-b svg{width:22px;height:22px}
  .pv-b.danger{color:#ff8fa0}
  .pv-stage{flex:1;position:relative;display:grid;place-items:center;min-height:0;overflow:hidden;touch-action:pan-y}
  .pv-stage img{position:absolute;inset:10px 0;width:100%;height:calc(100% - 20px);object-fit:contain}
  .pv-nav{position:absolute;top:50%;transform:translateY(-50%);width:52px;height:52px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;cursor:pointer}
  .pv-nav.l{left:14px}.pv-nav.r{right:14px}.pv-nav svg{width:26px;height:26px}
  .pv-empty{opacity:.75;text-align:center;line-height:1.7;font-size:16px}
  .pv-cap{margin:8px 14px 0;padding:10px 14px;border-radius:14px;border:0;background:rgba(255,255,255,.1);color:#fff;font:inherit;font-size:16px;outline:none}
  .pv-cap::placeholder{color:rgba(255,255,255,.5)}
  .pv-strip{display:flex;gap:8px;overflow-x:auto;padding:10px 14px 12px;scrollbar-width:none}
  .pv-strip::-webkit-scrollbar{display:none}
  .pv-th{flex:0 0 auto;width:58px;height:58px;border-radius:12px;overflow:hidden;border:2px solid transparent;padding:0;background:rgba(255,255,255,.08);cursor:pointer}
  .pv-th img{width:100%;height:100%;object-fit:cover;display:block}
  .pv-th.on{border-color:#fff}
  .pv-th.add{display:grid;place-items:center;color:#fff;border:2px dashed rgba(255,255,255,.35)}
  .pv-th.add svg{width:24px;height:24px}
  .pv-busy{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.55);font-size:14px}
  @media (max-width:520px){.pv-nav{display:none}}`;
  const SVG = {
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    l: '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
    r: '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
    trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 11.6A2 2 0 0 0 9.4 20.5h5.2a2 2 0 0 0 2-1.9L17.5 7M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    cam: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.4"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[k]}</svg>`;
  let viewer = null;

  function pickFiles(onFiles) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { const fs = Array.from(inp.files || []); inp.remove(); if (fs.length) onFiles(fs); });
    inp.click();
  }

  function openViewer(opts) {
    if (!document.getElementById('pvCss')) { const s = document.createElement('style'); s.id = 'pvCss'; s.textContent = CSS; document.head.appendChild(s); }
    closeViewer();
    const el = document.createElement('div');
    el.className = 'pv';
    document.body.appendChild(el);
    viewer = { el, opts, idx: 0, busy: '', note: {} };
    const list = opts.getList();
    const start = list.findIndex((p) => p.id === opts.startId);
    viewer.idx = start >= 0 ? start : 0;
    paint();
    el.addEventListener('click', onClick);
    el.addEventListener('change', onCap);
    let sx = null;
    el.addEventListener('touchstart', (e) => { if (e.target.closest('.pv-stage')) sx = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); });
    document.addEventListener('keydown', onKey, true);
  }
  function closeViewer() {
    if (!viewer) return;
    viewer.el.remove();
    document.removeEventListener('keydown', onKey, true);
    viewer = null;
  }
  function go(d) {
    const n = viewer.opts.getList().length;
    if (!n) return;
    viewer.idx = (viewer.idx + d + n) % n;
    paint();
  }
  function paint() {
    if (!viewer) return;
    const { el, opts } = viewer;
    const list = opts.getList();
    if (viewer.idx >= list.length) viewer.idx = Math.max(0, list.length - 1);
    const cur = list[viewer.idx];
    const keepCap = el.querySelector('.pv-cap');
    const typing = keepCap && document.activeElement === keepCap;
    el.innerHTML = `
      <div class="pv-top">
        <button class="pv-b" data-pv="close" aria-label="닫기">${svg('x')}</button>
        <h3>${opts.title || ''}${list.length ? `<small>${viewer.idx + 1} / ${list.length}</small>` : ''}</h3>
        ${cur ? `<button class="pv-b danger" data-pv="del" aria-label="사진 지우기">${svg('trash')}</button>` : ''}
        <button class="pv-b" data-pv="add" aria-label="사진 추가">${svg('cam')}</button>
      </div>
      <div class="pv-stage">
        ${cur ? bigTag(cur) : `<div class="pv-empty">${svg('cam').replace('<svg', '<svg style="width:46px;height:46px;opacity:.6"')}<br>아직 사진이 없어요<br><button class="pv-b" style="width:auto;padding:0 18px;margin-top:10px;background:rgba(255,255,255,.14)" data-pv="add">사진 추가</button></div>`}
        ${list.length > 1 ? `<button class="pv-nav l" data-pv="prev" aria-label="이전">${svg('l')}</button><button class="pv-nav r" data-pv="next" aria-label="다음">${svg('r')}</button>` : ''}
        ${viewer.busy ? `<div class="pv-busy">${viewer.busy}</div>` : cur && viewer.note[cur.id] ? `<div class="pv-busy">${viewer.note[cur.id]}</div>` : ''}
      </div>
      ${cur ? `<input class="pv-cap" maxlength="200" placeholder="한 줄 메모 (선택)" value="${String(cur.caption || '').replace(/"/g, '&quot;')}">` : ''}
      <div class="pv-strip">${list.map((p, i) => `<button class="pv-th ${i === viewer.idx ? 'on' : ''}" data-pv="pick" data-i="${i}">${imgTag(p.thumb || p.path)}</button>`).join('')}
        <button class="pv-th add" data-pv="add" aria-label="사진 추가">${svg('plus')}</button></div>`;
    hydrate(el);
    if (cur && cur.drive) loadOriginal(cur);
    if (typing) { const c = el.querySelector('.pv-cap'); if (c) c.focus(); }
    const on = el.querySelector('.pv-th.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  // 크게 보기: 원본이 드라이브에 있으면 작은 사진을 먼저 보여 주고, 원본이 오면 바꿔요
  const origOf = (p) => (typeof HaruBackup !== 'undefined' && HaruBackup.origCached(p)) || null;
  function bigTag(p) {
    if (!p.drive) return imgTag(p.path || p.thumb, '', '');
    const u = origOf(p);
    if (u) return `<img src="${u}" alt="" decoding="async" draggable="false">`;
    return imgTag(p.thumb, 'pv-low', '').replace('<img ', `<img data-orig="${String(p.id).replace(/"/g, '&quot;')}" `);
  }
  function loadOriginal(p) {
    if (typeof HaruBackup === 'undefined' || origOf(p)) return;
    HaruBackup.photoOriginalUrl(p).then((u) => {
      if (!viewer) return;
      const img = viewer.el.querySelector(`img[data-orig="${CSS_ESC(p.id)}"]`);
      if (img) { img.removeAttribute('data-photo'); img.classList.remove('pv-low'); img.src = u; }
      if (viewer.note[p.id]) { delete viewer.note[p.id]; paint(); }
    }).catch((e) => {
      if (!viewer) return;
      viewer.note[p.id] = e && e.code === 'need-key' ? '원본은 하루플래너 비밀번호를 넣으면 보여요 (설정 → 백업)' : '원본을 못 불러왔어요 · 작은 사진으로 보여요';
      const cur = viewer.opts.getList()[viewer.idx];
      if (cur && cur.id === p.id) paint();
    });
  }
  const CSS_ESC = (s) => (window.CSS && window.CSS.escape ? window.CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

  async function onClick(e) {
    const b = e.target.closest('[data-pv]');
    if (!b || !viewer) return;
    const k = b.dataset.pv;
    const { opts } = viewer;
    if (k === 'close') closeViewer();
    else if (k === 'prev') go(-1);
    else if (k === 'next') go(1);
    else if (k === 'pick') { viewer.idx = Number(b.dataset.i); paint(); } else if (k === 'add') {
      pickFiles(async (files) => {
        if (!viewer) return;
        for (let i = 0; i < files.length; i++) {
          viewer.busy = `사진 올리는 중… ${files.length > 1 ? `(${i + 1}/${files.length})` : ''}`;
          paint();
          try { await opts.onAdd(files[i]); } catch (err) { viewer.busy = ''; paint(); alertText(errText(err)); return; }
          if (!viewer) return;
          viewer.idx = opts.getList().length - 1;
        }
        viewer.busy = '';
        paint();
      });
    } else if (k === 'del') {
      const cur = opts.getList()[viewer.idx];
      if (!cur || !(await askConfirm('이 사진을 지울까요?\n되돌릴 수 없어요.', { okText: '지우기', danger: true }))) return;
      viewer.busy = '지우는 중…';
      paint();
      try { await opts.onDelete(cur); } catch (err) { alertText(errText(err)); }
      if (!viewer) return;
      viewer.busy = '';
      paint();
    }
  }
  function onCap(e) {
    if (!viewer || !e.target.classList.contains('pv-cap')) return;
    const cur = viewer.opts.getList()[viewer.idx];
    if (cur && viewer.opts.onCaption) viewer.opts.onCaption(cur, e.target.value.trim());
  }
  function onKey(e) {
    if (!viewer) return;
    if (e.target && e.target.classList && e.target.classList.contains('pv-cap')) { if (e.key === 'Enter') e.target.blur(); if (e.key !== 'Escape') return; }
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeViewer(); } else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); } else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
  }
  const alertText = (m) => setTimeout(() => showAlert(m), 0);
  // 다른 기기에서 사진이 바뀌면 열려 있는 창도 다시 그려요
  function refreshViewer() { if (viewer) paint(); }

  return { add, removeFiles, hydrate, cachedUrl, fetchUrls, imgTag, clearCache, openViewer, closeViewer, refreshViewer, pickFiles, errText, ready, isOpen: () => !!viewer };
})();
