'use strict';

/* =========================================================================
 * 포스트잇 탭 (폰) — PC 포스트잇과 같은 데이터(state.data.notes)라서 클라우드로 바로 맞춰져요.
 * 한 장: { id, text, doc, color, tone: 'pastel'|'vivid', fontSize, opacity, createdAt, updatedAt } (PC widget.js 와 같은 모양)
 *  - doc: 서식 있는 내용 (할 일 체크박스 · 글자별 크기 · 색 — notedoc.js). text 는 같은 내용을 글자로 (☐ ☑ •)
 *  - opacity(배경 비침)는 PC 바탕화면용이라 폰에서는 건드리지 않고 그대로 둬요.
 * 화면 도구(state · head · openSheet · save …)는 mobile.js 것을 써요. (이 파일이 먼저 읽혀서, 쓰는 건 눌렀을 때만)
 * ========================================================================= */
const MNotes = (() => {
  const PASTEL = ['#fff3a3', '#ffd6e0', '#d4f5d4', '#d6e8ff', '#ecdcff']; // PC 와 같은 색
  const VIVID = ['#ffe733', '#ffb340', '#ff8cc6', '#9ee86a', '#5fd2ff', '#c39bff'];
  const FONT = { min: 12, max: 32, def: 17 };
  const IOS = /iP(hone|od|ad)/.test(navigator.userAgent);
  // 열려 있는 포스트잇. fresh: 아직 목록에 넣지 않은 새 포스트잇 (첫 글자를 적으면 넣어요 → 빈 포스트잇이 PC 에 먼저 뜨지 않게)
  let ed = null; // { id, fresh, note(새 것일 때만), created, palette, typedAt }
  let saveT = 0;

  const notes = () => { if (!Array.isArray(state.data.notes)) state.data.notes = []; return state.data.notes; };
  const byId = (id) => notes().find((n) => n.id === id);
  // 다른 기기에서 고친 내용이 오면 배열 안 객체가 통째로 바뀌어서, 늘 id 로 다시 찾아요
  const cur = () => (ed ? (ed.fresh ? ed.note : byId(ed.id)) : null);
  const fsOf = (n) => clamp(Math.round(Number(n && n.fontSize) || FONT.def), FONT.min, FONT.max);
  const shownFs = (n) => (IOS ? Math.max(16, fsOf(n)) : fsOf(n)); // 아이폰은 16px 보다 작은 칸을 누르면 화면을 확대해요
  function when(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const t = `${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;
    const day = ymd(d);
    if (day === todayStr()) return `오늘 ${t}`;
    if (day === addDays(todayStr(), -1)) return `어제 ${t}`;
    return `${d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  const stamp = (n) => n.updatedAt || n.createdAt || 0;
  const blank = (n) => !NoteDoc.docOf(n).some((b) => b.r.some((r) => r.x.trim())); // 글자가 하나도 없어요 (빈 체크박스만 있어도)

  function view() {
    const list = notes().slice().sort((a, b) => stamp(b) - stamp(a));
    return `${head('포스트잇')}
      ${list.length ? `<div class="mn-grid">${list.map((n) => `
        <button class="mn-card${n.tone === 'vivid' ? ' vivid' : ''}" style="--nc:${esc(n.color || PASTEL[0])}" data-mn="open" data-id="${esc(n.id)}">
          <span class="mn-text nd-view">${blank(n) ? '<i>빈 포스트잇</i>' : NoteDoc.html(NoteDoc.docOf(n))}</span>
          <span class="mn-when">${esc(when(stamp(n)))}</span>
        </button>`).join('')}</div>` : empty('sticky', '아직 포스트잇이 없어요', '+ 를 눌러 메모를 적어 보세요')}
      <div class="m-bottom-space"></div>`;
  }

  // ---------- 한 장 열기 (시트) ----------
  // 글자 칸은 처음 한 번만 그리고, 색 · 글자 크기를 바꿀 땐 위쪽만 다시 그려요 (적는 중에 키보드가 닫히지 않게)
  function topHTML() {
    const n = cur();
    return `<button class="mn-ib" data-mn="close" aria-label="닫기">${icon('x')}</button>
      <span class="mn-ed-when">${ed.fresh ? '새 포스트잇' : esc(when(stamp(n)))}</span>
      <span class="flex1"></span>
      <button class="mn-ib ${ed.palette ? 'on' : ''}" data-mn="palette" aria-label="색 · 글자 크기">${icon('palette')}</button>
      ${ed.fresh ? '' : `<button class="mn-ib" data-mn="del" aria-label="이 포스트잇 지우기">${icon('trash')}</button>`}`;
  }
  function palHTML() {
    if (!ed.palette) return '';
    const n = cur();
    const vivid = n.tone === 'vivid';
    const fs = fsOf(n);
    const sw = (list, tone) => list.map((c) => `<button class="mn-c ${c === n.color && (tone === 'vivid') === vivid ? 'on' : ''}" style="--c:${c}" data-mn="color" data-c="${c}" data-tone="${tone}" aria-label="이 색으로"></button>`).join('');
    return `<div class="mn-pal">
      <div class="mn-pal-row"><span>파스텔</span>${sw(PASTEL, 'pastel')}</div>
      <div class="mn-pal-row"><span>선명</span>${sw(VIVID, 'vivid')}</div>
      <div class="mn-pal-row"><span>글자</span><button class="mn-fs" data-mn="font" data-d="-1" aria-label="글자 작게" ${fs <= FONT.min ? 'disabled' : ''}>A−</button><b>${fs}</b><button class="mn-fs big" data-mn="font" data-d="1" aria-label="글자 크게" ${fs >= FONT.max ? 'disabled' : ''}>A+</button></div>
    </div>`;
  }
  function edHTML() {
    const n = cur();
    return `<div class="mn-ed">
      <div class="mn-ed-top">${topHTML()}</div>
      <div class="mn-pal-wrap">${palHTML()}</div>
      <div class="mn-dock"></div>
      <div id="mnText" class="mn-ta" style="font-size:${shownFs(n)}px"></div>
    </div>`;
  }
  // Notion 처럼 서식 넣는 칸 (notedoc.js) — 위쪽 막대로 할 일 · 글자 크기 · 색, 줄 맨 앞 "[] " 나 "/" 로도 할 일
  function mountEditor(el, n) {
    ed.editor = NoteDoc.editor(el.querySelector('#mnText'), {
      placeholder: '메모를 적어 보세요… ( / 로 할 일 · 제목)',
      readOnly: !!state.offline,
      dock: el.querySelector('.mn-dock'),
      base: () => { const c = cur(); return c ? shownFs(c) : FONT.def; },
      onChange: edited,
    });
    ed.editor.set(NoteDoc.docOf(n));
  }
  const mySheet = () => { const sh = topSheet(); return sh && sh.el.classList.contains('mn-sheet') ? sh : null; };
  function paintLook(el, n) {
    el.style.setProperty('--nc', n.color || PASTEL[0]);
    el.classList.toggle('vivid', n.tone === 'vivid');
  }
  function paint() {
    const sh = mySheet();
    const n = cur();
    if (!sh || !n) return;
    paintLook(sh.el, n);
    const top = sh.el.querySelector('.mn-ed-top');
    if (top) top.innerHTML = topHTML();
    const pal = sh.el.querySelector('.mn-pal-wrap');
    if (pal) pal.innerHTML = palHTML();
    const ta = sh.el.querySelector('#mnText');
    if (ta) ta.style.fontSize = `${shownFs(n)}px`;
    if (ed.editor) ed.editor.refresh();
  }
  function open(id) {
    const n = id ? byId(id) : null;
    if (id && !n) return;
    if (!id && !canEdit()) return;
    if (n) ed = { id: n.id, fresh: false };
    else {
      const nid = uid();
      ed = { id: nid, fresh: true, note: { id: nid, text: '', color: PASTEL[notes().length % PASTEL.length], createdAt: Date.now(), updatedAt: Date.now() } };
    }
    const first = cur();
    openSheet(edHTML(), {
      cls: 'mn-sheet',
      onClose: finish,
      onMount: (el) => {
        paintLook(el, first);
        mountEditor(el, first);
        if (blank(first) && !state.offline) setTimeout(() => { if (ed && ed.editor) ed.editor.focus(true); }, 80);
      },
    });
  }
  function flush() {
    clearTimeout(saveT);
    saveT = 0;
    if (ed && !ed.fresh) save();
  }
  // 시트를 닫을 때: 적은 걸 바로 올려요. 여기서 만들었는데 글자를 다 지웠으면 빈 포스트잇은 남기지 않아요
  function finish() {
    if (!ed) return;
    clearTimeout(saveT);
    saveT = 0;
    const n = cur();
    if (!ed.fresh && n) {
      if (ed.created && blank(n)) state.data.notes = notes().filter((x) => x.id !== n.id);
      save();
    }
    if (ed.editor) ed.editor.destroy();
    ed = null;
    render();
  }
  function touch(n) { // 색 · 글자 크기처럼 바로 저장할 것
    n.updatedAt = Date.now();
    if (!ed.fresh) save();
  }

  function edited(doc) {
    if (!ed || !state.data || state.offline) return;
    ed.typedAt = Date.now();
    if (ed.fresh) {
      if (NoteDoc.isEmpty(doc)) return; // 아직 아무것도 안 적었어요
      notes().push(ed.note);
      ed.fresh = false;
      ed.created = true;
      delete ed.note;
      const sh = mySheet();
      const top = sh && sh.el.querySelector('.mn-ed-top');
      if (top) top.innerHTML = topHTML(); // 이제 지우기 버튼도 보여요
    }
    const n = cur();
    if (!n) return;
    n.doc = doc;
    n.text = NoteDoc.plainOf(doc);
    n.updatedAt = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(flush, 350); // 적는 동안 조금씩 모아서 올려요 (1초 안에 PC 에 보여요)
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mn]');
    if (!el || !state.data) return;
    const a = el.dataset.mn;
    if (a === 'open') { if (!cardCheck(e, el)) open(el.dataset.id); return; }
    if (!ed) return;
    const n = cur();
    switch (a) {
      case 'close': closeSheet(); break;
      case 'palette': ed.palette = !ed.palette; paint(); break;
      case 'color':
        if (!n || !canEdit()) break;
        n.color = el.dataset.c;
        n.tone = el.dataset.tone === 'vivid' ? 'vivid' : 'pastel';
        touch(n);
        paint();
        break;
      case 'font':
        if (!n || !canEdit()) break;
        n.fontSize = clamp(fsOf(n) + Number(el.dataset.d), FONT.min, FONT.max);
        touch(n);
        paint();
        break;
      case 'del': {
        if (!n || ed.fresh || !canEdit()) break;
        const gone = n;
        clearTimeout(saveT);
        saveT = 0;
        if (ed.editor) ed.editor.destroy();
        ed = null;
        closeSheet({ silent: true });
        state.data.notes = notes().filter((x) => x.id !== gone.id);
        commit();
        toast('포스트잇을 지웠어요', { action: '되돌리기', onAction: () => { if (!byId(gone.id)) { notes().push(gone); commit(); } } });
        break;
      }
      default: break;
    }
  });

  // 다른 기기(PC)에서 바뀐 게 오면: 열어 둔 포스트잇도 바로 고쳐요 (지금 적고 있는 중이면 기다려요)
  function remote() {
    if (!ed || ed.fresh || !mySheet()) return;
    const n = byId(ed.id);
    if (!n) {
      if (ed.editor) ed.editor.destroy();
      ed = null;
      closeSheet({ silent: true });
      toast('다른 기기에서 이 포스트잇을 지웠어요');
      return;
    }
    paint();
    const E = ed.editor;
    if (!E) return;
    const typing = E.focused() && Date.now() - (ed.typedAt || 0) < 1500;
    if (saveT || typing || E.composing()) return;
    const d = NoteDoc.docOf(n);
    if (!E.same(d)) E.set(d, true);
  }

  // 목록 카드의 체크박스는 열지 않고 바로 체크해요
  function cardCheck(e, card) {
    const blk = e.target.closest('.nd-todo');
    if (!blk || !card.contains(blk) || !canEdit()) return false;
    const pad = parseFloat(getComputedStyle(blk).paddingLeft) || 24;
    if (e.clientX - blk.getBoundingClientRect().left > pad + 4) return false;
    const n = byId(card.dataset.id);
    if (!n) return false;
    const d = NoteDoc.docOf(n);
    const bi = Array.from(blk.parentNode.children).indexOf(blk);
    if (!d[bi] || d[bi].t !== 'todo') return false;
    if (d[bi].c) delete d[bi].c; else d[bi].c = 1;
    n.doc = d;
    n.text = NoteDoc.plainOf(d);
    n.updatedAt = Date.now();
    commit();
    return true;
  }

  // 적다가 앱을 내리거나 닫으면 기다리지 않고 바로 올려요 (mobile.js 의 pagehide 보다 먼저 불려요)
  window.addEventListener('pagehide', () => { if (saveT) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveT) flush(); });

  return { view, add: () => open(null), remote };
})();
