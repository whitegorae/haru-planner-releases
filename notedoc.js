'use strict';

/* =========================================================================
 * 포스트잇 서식 편집기 (Notion 처럼) — PC 포스트잇 창(widget.js) · 폰 포스트잇(notes-m.js) 이 같이 써요.
 *
 * 한 장의 내용: n.doc = [블록, …]
 *   블록 { t: 'p' 텍스트 | 'todo' 할 일 | 'h1' 'h2' 'h3' 제목 | 'ul' 글머리 기호, c: 1 (할 일 체크), r: [글자 조각, …] }
 *   글자 조각 { x: 글자, b 굵게, i 기울임, u 밑줄, s 취소선, fc: 글자 색, bg: 배경 색, z: 크기 배율 (1 = 기본) }
 * n.text 도 늘 같이 적어요 (할 일은 ☐ / ☑, 글머리는 • 로 시작하는 줄) — 목록 미리보기 · 예전 버전 앱용.
 * 예전 버전이 text 만 고쳐서 doc 와 안 맞으면 text 로 다시 만들어요 (체크박스는 ☐ ☑ 로 살아남아요).
 *
 * 편집기: contenteditable 위에서 글자 입력은 브라우저(한글 조합 포함)에 맡기고,
 *        줄 나누기 · 합치기 · 서식 · 붙여넣기 · 되돌리기는 위 모양(doc)을 고친 뒤 다시 그려요.
 * ========================================================================= */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NoteDoc = api;
})(function () {
  const TYPES = ['p', 'todo', 'h1', 'h2', 'h3', 'ul'];
  const COLORS = [['gray', '회색'], ['brown', '갈색'], ['orange', '주황'], ['yellow', '노랑'], ['green', '초록'], ['blue', '파랑'], ['purple', '보라'], ['pink', '분홍'], ['red', '빨강']];
  const CNAMES = COLORS.map((c) => c[0]);
  const ZS = [0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5]; // 글자 크기 단계 (기본 크기에 곱해요)
  const MK = ['b', 'i', 'u', 's', 'fc', 'bg', 'z'];
  const MAXB = 1500; // 블록 수
  const MAXT = 12000; // 글자 수 (n.text 20000 자 안에 늘 들어가게)
  const BLOCKS = [ // 슬래시(/) 메뉴 · 블록 바꾸기 메뉴
    { t: 'p', name: '텍스트', ico: 'T', keys: 'text p 텍스트 글 본문 일반' },
    { t: 'todo', name: '할 일 목록', ico: 'chk', keys: 'todo check checkbox 할일 할 일 체크 체크박스 투두' },
    { t: 'h1', name: '제목 1', ico: 'H1', keys: 'h1 heading 제목1 제목 1 큰제목' },
    { t: 'h2', name: '제목 2', ico: 'H2', keys: 'h2 heading 제목2 제목 2 중간제목' },
    { t: 'h3', name: '제목 3', ico: 'H3', keys: 'h3 heading 제목3 제목 3 작은제목' },
    { t: 'ul', name: '글머리 기호 목록', ico: '•', keys: 'ul bullet list 글머리 기호 목록 점' },
  ];
  const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.6" y="1.6" width="12.8" height="12.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.6 8.3l2.3 2.3 4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- 모양(doc) 다루기 ----------
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
  const escA = (s) => esc(s).replace(/"/g, '&quot;');
  const clone = (d) => JSON.parse(JSON.stringify(d));
  const textOf = (b) => (b && b.r ? b.r.map((r) => r.x).join('') : '');
  const lenOf = (b) => textOf(b).length;
  const at = (b, o) => ({ b, o });
  const cmp = (p, q) => (p.b - q.b) || (p.o - q.o);
  const snapZ = (z) => { let best = 1; for (const s of ZS) if (Math.abs(s - z) < Math.abs(best - z)) best = s; return best; };
  const sameMarks = (a, b) => MK.every((k) => (a[k] || 0) === (b[k] || 0));
  const marksOnly = (r) => { const o = {}; for (const k of MK) if (r && r[k]) o[k] = r[k]; return o; };

  function cleanRun(r) {
    if (!r || typeof r.x !== 'string') return null;
    const x = r.x.replace(/ /g, ' ').replace(/[\r​﻿]/g, '');
    if (!x) return null;
    const o = { x };
    for (const k of ['b', 'i', 'u', 's']) if (r[k]) o[k] = 1;
    if (CNAMES.includes(r.fc)) o.fc = r.fc;
    if (CNAMES.includes(r.bg)) o.bg = r.bg;
    const z = Number(r.z);
    if (z && Number.isFinite(z)) { const s = snapZ(z); if (s !== 1) o.z = s; }
    return o;
  }
  function mergeRuns(runs) {
    const out = [];
    for (const r of runs) {
      if (!r || !r.x) continue;
      const last = out[out.length - 1];
      if (last && sameMarks(last, r)) last.x += r.x;
      else out.push({ ...r });
    }
    return out;
  }
  function clean(doc) {
    const out = [];
    let left = MAXT;
    for (const b of Array.isArray(doc) ? doc : []) {
      if (out.length >= MAXB) break;
      if (!b || typeof b !== 'object') continue;
      const t = TYPES.includes(b.t) ? b.t : 'p';
      const runs = [];
      for (const r of mergeRuns((Array.isArray(b.r) ? b.r : []).map(cleanRun).filter(Boolean))) {
        if (left <= 0) break;
        if (r.x.length > left) r.x = r.x.slice(0, left);
        left -= r.x.length;
        runs.push(r);
      }
      const nb = { t, r: runs };
      if (t === 'todo' && b.c) nb.c = 1;
      out.push(nb);
    }
    if (!out.length) out.push({ t: 'p', r: [] });
    return out;
  }
  function plainOf(doc) {
    return clean(doc).map((b) => (b.t === 'todo' ? (b.c ? '☑ ' : '☐ ') : b.t === 'ul' ? '• ' : '') + textOf(b)).join('\n');
  }
  // 글자만 있는 메모 → 블록 (☐ / [ ] 는 할 일, ☑ / [x] 는 끝낸 할 일, • 는 글머리 기호)
  function fromText(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    return clean(lines.map((line) => {
      let m;
      if ((m = /^(☐|\[ ?\]) ?/.exec(line))) return { t: 'todo', r: [{ x: line.slice(m[0].length) }] };
      if ((m = /^(☑|✅|\[[xX]\]) ?/.exec(line))) return { t: 'todo', c: 1, r: [{ x: line.slice(m[0].length) }] };
      if (/^• /.test(line)) return { t: 'ul', r: [{ x: line.slice(2) }] };
      return { t: 'p', r: [{ x: line }] };
    }));
  }
  function docOf(n) {
    const text = String((n && n.text) || '');
    if (n && Array.isArray(n.doc)) {
      const d = clean(n.doc);
      if (plainOf(d) === text) return d;
    }
    return fromText(text);
  }
  const isEmpty = (doc) => !doc || !doc.length || (doc.length === 1 && doc[0].t === 'p' && !lenOf(doc[0]));
  const sameDoc = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

  function slice(runs, a, z) {
    const out = [];
    let p = 0;
    for (const r of runs) {
      const s = p;
      const e = p + r.x.length;
      p = e;
      if (e <= a || s >= z) continue;
      out.push({ ...r, x: r.x.slice(Math.max(0, a - s), Math.min(r.x.length, z - s)) });
    }
    return out.filter((r) => r.x);
  }
  function deleteRange(doc, s, e) {
    const d = clone(doc);
    const A = d[s.b];
    const B = d[e.b];
    const nb = { ...A, r: mergeRuns(slice(A.r, 0, s.o).concat(slice(B.r, e.o, lenOf(B)))) };
    d.splice(s.b, e.b - s.b + 1, nb);
    return d;
  }
  function sliceDoc(doc, s, e) {
    const out = [];
    for (let i = s.b; i <= e.b; i++) {
      const B = doc[i];
      const nb = { t: B.t, r: slice(B.r, i === s.b ? s.o : 0, i === e.b ? e.o : lenOf(B)) };
      if (B.c) nb.c = 1;
      out.push(nb);
    }
    if (out.length === 1) out[0].t = 'p'; // 한 줄 안의 일부만 고른 건 글자만
    return out;
  }
  function insertRuns(doc, pos, runs) {
    const d = clone(doc);
    const B = d[pos.b];
    const n = runs.reduce((a, r) => a + r.x.length, 0);
    B.r = mergeRuns(slice(B.r, 0, pos.o).concat(runs, slice(B.r, pos.o, lenOf(B))));
    return { doc: d, pos: at(pos.b, pos.o + n) };
  }
  function insertFrag(doc, pos, frag) {
    if (frag.length === 1) return insertRuns(doc, pos, frag[0].r);
    const d = clone(doc);
    const B = d[pos.b];
    const len = lenOf(B);
    const pre = slice(B.r, 0, pos.o);
    const post = slice(B.r, pos.o, len);
    const first = { ...B, r: mergeRuns(pre.concat(frag[0].r)) };
    if (!len && B.t === 'p') { first.t = frag[0].t; if (frag[0].c) first.c = 1; } // 빈 줄에 붙이면 붙인 모양 그대로
    const lastF = frag[frag.length - 1];
    const last = { t: lastF.t, r: mergeRuns(lastF.r.concat(post)) };
    if (lastF.c) last.c = 1;
    d.splice(pos.b, 1, first, ...clone(frag.slice(1, -1)), last);
    return { doc: d, pos: at(pos.b + frag.length - 1, lenOf(lastF)) };
  }
  // Enter: 할 일 · 글머리는 같은 모양으로 이어 가고, 제목 다음 줄은 텍스트
  function splitBlock(doc, pos) {
    const d = clone(doc);
    const B = d[pos.b];
    const len = lenOf(B);
    const nextT = B.t === 'todo' || B.t === 'ul' ? B.t : 'p';
    if (pos.o === 0 && len) { // 줄 맨 앞: 위에 빈 줄을 넣어요 (지금 줄 모양은 그대로)
      d.splice(pos.b, 0, { t: nextT, r: [] });
      return { doc: d, pos: at(pos.b + 1, 0) };
    }
    const right = slice(B.r, pos.o, len);
    B.r = slice(B.r, 0, pos.o);
    d.splice(pos.b + 1, 0, { t: nextT, r: right });
    return { doc: d, pos: at(pos.b + 1, 0) };
  }
  // 고른 범위에 서식 하나 (val 이 비면 빼요)
  function mark(doc, s, e, key, val) {
    const d = clone(doc);
    for (let bi = s.b; bi <= e.b; bi++) {
      const B = d[bi];
      const len = lenOf(B);
      const a = bi === s.b ? s.o : 0;
      const z = bi === e.b ? e.o : len;
      if (a >= z) continue;
      const mid = slice(B.r, a, z).map((r) => {
        const o = { ...r };
        if (val && !(key === 'z' && val === 1)) o[key] = val;
        else delete o[key];
        return o;
      });
      B.r = mergeRuns(slice(B.r, 0, a).concat(mid, slice(B.r, z, len)));
    }
    return d;
  }
  // 커서 바로 앞 글자의 서식 (줄 맨 앞이면 뒤 글자)
  function marksBefore(doc, pos) {
    const B = doc[pos.b];
    if (!B) return {};
    const r = slice(B.r, Math.max(0, pos.o - 1), pos.o)[0] || slice(B.r, pos.o, pos.o + 1)[0];
    return marksOnly(r);
  }
  // 고른 범위의 서식: 굵게 등은 "다 그런가", 색 · 크기는 "다 같으면 그 값 / 섞이면 'mix'"
  function marksAt(doc, s, e) {
    if (!cmp(s, e)) {
      const m = marksBefore(doc, s);
      return { b: !!m.b, i: !!m.i, u: !!m.u, s: !!m.s, fc: m.fc || '', bg: m.bg || '', z: m.z || 1 };
    }
    const runs = [];
    for (let bi = s.b; bi <= e.b; bi++) {
      const B = doc[bi];
      runs.push(...slice(B.r, bi === s.b ? s.o : 0, bi === e.b ? e.o : lenOf(B)));
    }
    if (!runs.length) return { b: false, i: false, u: false, s: false, fc: '', bg: '', z: 1 };
    const one = (k, dv) => { const v = runs[0][k] || dv; return runs.every((r) => (r[k] || dv) === v) ? v : 'mix'; };
    return { b: runs.every((r) => r.b), i: runs.every((r) => r.i), u: runs.every((r) => r.u), s: runs.every((r) => r.s), fc: one('fc', ''), bg: one('bg', ''), z: one('z', 1) };
  }

  // ---------- 그리기 ----------
  function runHTML(r) {
    const cls = [];
    for (const k of ['b', 'i', 'u', 's']) if (r[k]) cls.push(`nd-m${k}`);
    if (r.fc) cls.push(`nd-fc-${r.fc}`);
    if (r.bg) cls.push(`nd-bg-${r.bg}`);
    const st = r.z ? ` style="font-size: ${r.z}em;"` : '';
    if (!cls.length && !st) return esc(r.x);
    return `<span${cls.length ? ` class="${cls.join(' ')}"` : ''}${st}>${esc(r.x)}</span>`;
  }
  function blockHTML(b) {
    const tx = textOf(b);
    const inner = b.r.map(runHTML).join('') + (!tx || tx.endsWith('\n') ? '<br>' : '');
    return `<div class="nd-b nd-${b.t}${b.c ? ' on' : ''}" data-t="${b.t}"${b.c ? ' data-c="1"' : ''}>${inner}</div>`;
  }
  const html = (doc) => doc.map(blockHTML).join('');

  // ---------- 화면(DOM) → 모양 ----------
  const blockNodes = (root) => Array.from(root.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.nodeValue.length));
  function marksOfEl(el, m) {
    const o = { ...m };
    const tag = el.nodeName;
    if (tag === 'B' || tag === 'STRONG') o.b = 1;
    if (tag === 'I' || tag === 'EM') o.i = 1;
    if (tag === 'U') o.u = 1;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') o.s = 1;
    if (el.classList) {
      for (const c of el.classList) {
        if (c === 'nd-mb') o.b = 1;
        else if (c === 'nd-mi') o.i = 1;
        else if (c === 'nd-mu') o.u = 1;
        else if (c === 'nd-ms') o.s = 1;
        else if (c.startsWith('nd-fc-')) o.fc = c.slice(6);
        else if (c.startsWith('nd-bg-')) o.bg = c.slice(6);
      }
    }
    const fs = el.style && el.style.fontSize;
    if (fs && /em$/.test(fs)) o.z = (o.z || 1) * parseFloat(fs);
    return o;
  }
  function trailingBr(br, blockEl) {
    let n = br;
    while (n && n !== blockEl) {
      for (let s = n.nextSibling; s; s = s.nextSibling) {
        if (s.nodeType === 3 && s.nodeValue.length) return false;
        if (s.nodeType === 1 && (s.nodeName === 'BR' || s.textContent.length || (s.querySelector && s.querySelector('br')))) return false;
      }
      n = n.parentNode;
    }
    return true;
  }
  function walk(node, m, out, blockEl) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) { if (ch.nodeValue) out.push({ ...m, x: ch.nodeValue }); }
      else if (ch.nodeType === 1) {
        if (ch.nodeName === 'BR') { if (!trailingBr(ch, blockEl)) out.push({ ...m, x: '\n' }); }
        else if (ch.nodeName === 'DIV' || ch.nodeName === 'P') {
          const tx = out.map((r) => r.x).join('');
          if (tx && !tx.endsWith('\n')) out.push({ ...m, x: '\n' });
          walk(ch, marksOfEl(ch, m), out, blockEl);
        } else walk(ch, marksOfEl(ch, m), out, blockEl);
      }
    }
  }
  function parse(root) {
    const doc = [];
    for (const node of blockNodes(root)) {
      if (node.nodeType === 3) { doc.push({ t: 'p', r: [{ x: node.nodeValue }] }); continue; }
      if (node.nodeName === 'BR') { doc.push({ t: 'p', r: [] }); continue; }
      const t = TYPES.includes(node.dataset && node.dataset.t) ? node.dataset.t : 'p';
      const b = { t, r: [] };
      if (t === 'todo' && node.dataset.c === '1') b.c = 1;
      walk(node, {}, b.r, node);
      doc.push(b);
    }
    return clean(doc);
  }

  // ---------- 커서 위치 (블록 번호 · 글자 위치) ----------
  function posOf(root, node, off) {
    const blocks = blockNodes(root);
    if (node === root) {
      if (!blocks.length) return at(0, 0);
      const kids = Array.from(root.childNodes);
      const k = kids[Math.min(off, kids.length - 1)];
      let b = blocks.indexOf(k);
      if (off >= kids.length || b < 0) { b = blocks.length - 1; return at(b, blocks[b].textContent.length); }
      return at(b, 0);
    }
    let blk = node;
    while (blk && blk.parentNode !== root) blk = blk.parentNode;
    if (!blk) return null;
    const b = blocks.indexOf(blk);
    if (b < 0) return null;
    if (blk.nodeType === 3) return at(b, Math.min(off, blk.nodeValue.length));
    const r = document.createRange();
    r.setStart(blk, 0);
    try { r.setEnd(node, off); } catch (_) { return at(b, 0); }
    return at(b, r.toString().length);
  }
  function domPos(root, p) {
    const blocks = blockNodes(root);
    if (!blocks.length) return [root, 0];
    const blk = blocks[Math.max(0, Math.min(p.b, blocks.length - 1))];
    if (blk.nodeType === 3) return [blk, Math.min(p.o, blk.nodeValue.length)];
    const tw = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
    let left = p.o;
    let last = null;
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const n = t.nodeValue.length;
      if (left <= n) return [t, left]; // 경계에선 앞 조각 끝에 (앞 글자 서식을 이어서 쳐요)
      left -= n;
      last = t;
    }
    if (last) return [last, last.nodeValue.length];
    return [blk, 0];
  }

  // =========================================================================
  // 편집기
  // opt: { onChange(doc), placeholder, readOnly, base: () => 기본 글자 px, dock: 서식 막대를 넣을 칸(폰) | 없으면 떠 있는 막대(PC) }
  // =========================================================================
  function editor(root, opt = {}) {
    const E = { doc: [{ t: 'p', r: [] }], composing: false, hist: [], fut: [], lastKind: '', lastAt: 0, pending: null, sel: null, slash: null, slashArm: false, dead: false };
    root.classList.add('nd');
    root.setAttribute('contenteditable', opt.readOnly ? 'false' : 'true');
    root.setAttribute('spellcheck', 'false');
    if (opt.placeholder) root.dataset.ph = opt.placeholder;
    const listeners = [];
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); };

    // ----- 고른 범위 -----
    function domSel() {
      const s = window.getSelection();
      if (!s || !s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
      const a = posOf(root, s.anchorNode, s.anchorOffset);
      const f = posOf(root, s.focusNode, s.focusOffset);
      if (!a || !f) return null;
      const [st, en] = cmp(a, f) <= 0 ? [a, f] : [f, a];
      return { s: st, e: en, collapsed: !cmp(st, en) };
    }
    const curSel = () => domSel() || E.sel;
    function setSel(sel) {
      if (!sel || E.dead) return;
      const s = window.getSelection();
      if (!s) return;
      const clampP = (p) => { const b = Math.max(0, Math.min(p.b, E.doc.length - 1)); return at(b, Math.max(0, Math.min(p.o, lenOf(E.doc[b])))); };
      const [an, ao] = domPos(root, clampP(sel.s));
      const [fn, fo] = domPos(root, clampP(sel.e || sel.s));
      try { s.setBaseAndExtent(an, ao, fn, fo); } catch (_) { /* 그려지는 중 */ }
      E.sel = { s: clampP(sel.s), e: clampP(sel.e || sel.s), collapsed: !cmp(clampP(sel.s), clampP(sel.e || sel.s)) };
    }
    const focused = () => document.activeElement === root;

    // ----- 그리기 · 바꾸기 -----
    function paintEmpty() { root.classList.toggle('is-empty', isEmpty(E.doc)); }
    function render(sel) {
      root.innerHTML = html(E.doc);
      paintEmpty();
      if (sel && focused()) setSel(sel);
    }
    function emit() { if (typeof opt.onChange === 'function') opt.onChange(clone(E.doc)); }
    function snap() { return { d: JSON.stringify(E.doc), s: curSel() }; }
    function remember(kind) {
      const now = Date.now();
      if (kind === 'typing' && E.lastKind === 'typing' && now - E.lastAt < 1200) { E.lastAt = now; return; }
      E.hist.push(snap());
      if (E.hist.length > 200) E.hist.shift();
      E.fut = [];
      E.lastKind = kind;
      E.lastAt = now;
    }
    function apply(doc, sel, kind = 'edit') { // 모양을 바꾸고 다시 그려요
      if (kind) remember(kind);
      E.doc = clean(doc);
      E.pending = null;
      render(sel);
      if (!sel) paintEmpty();
      emit();
      bar.update();
    }
    function undo() {
      if (!E.hist.length) return;
      E.fut.push(snap());
      const h = E.hist.pop();
      E.doc = JSON.parse(h.d);
      E.lastKind = '';
      render(h.s);
      emit();
      bar.update();
    }
    function redo() {
      if (!E.fut.length) return;
      E.hist.push(snap());
      const h = E.fut.pop();
      E.doc = JSON.parse(h.d);
      E.lastKind = '';
      render(h.s);
      emit();
      bar.update();
    }

    // ----- 블록 · 서식 동작 -----
    function setType(t, sel = curSel()) {
      if (!sel || opt.readOnly) return;
      const d = clone(E.doc);
      const all = d.slice(sel.s.b, sel.e.b + 1).every((b) => b.t === t);
      for (let i = sel.s.b; i <= sel.e.b; i++) {
        d[i].t = all && t !== 'p' ? 'p' : t; // 이미 다 그 모양이면 텍스트로 (켜고 끄기)
        if (d[i].t !== 'todo') delete d[i].c;
      }
      apply(d, sel);
    }
    function toggleCheck(bi, sel) {
      if (opt.readOnly) return;
      const d = clone(E.doc);
      const B = d[bi];
      if (!B || B.t !== 'todo') return;
      if (B.c) delete B.c; else B.c = 1;
      apply(d, sel || null);
    }
    function format(key, val) {
      const sel = curSel();
      if (!sel || opt.readOnly) return;
      if (sel.collapsed) { // 고른 글자가 없으면 이어서 칠 글자에 (Notion 처럼)
        const base = E.pending && !cmp(E.pending.pos, sel.s) ? E.pending.marks : marksBefore(E.doc, sel.s);
        const m = { ...base };
        if (val && !(key === 'z' && val === 1)) m[key] = val; else delete m[key];
        E.pending = { pos: sel.s, marks: m };
        if (!focused()) { root.focus(); setSel(sel); }
        bar.update();
        return;
      }
      apply(mark(E.doc, sel.s, sel.e, key, val), sel);
    }
    function toggleMark(k) {
      const sel = curSel();
      if (!sel) return;
      const m = marks();
      format(k, m[k] ? 0 : 1);
    }
    function stepZ(dir) {
      const m = marks();
      const z = m.z === 'mix' ? 1 : (m.z || 1);
      const i = Math.max(0, Math.min(ZS.length - 1, ZS.indexOf(snapZ(z)) + dir));
      format('z', ZS[i]);
    }
    function marks() {
      const sel = curSel();
      if (!sel) return { b: false, i: false, u: false, s: false, fc: '', bg: '', z: 1 };
      if (sel.collapsed && E.pending && !cmp(E.pending.pos, sel.s)) {
        const m = E.pending.marks;
        return { b: !!m.b, i: !!m.i, u: !!m.u, s: !!m.s, fc: m.fc || '', bg: m.bg || '', z: m.z || 1 };
      }
      return marksAt(E.doc, sel.s, sel.e);
    }
    function blockType() { const sel = curSel(); return sel ? E.doc[sel.s.b] && E.doc[sel.s.b].t : 'p'; }

    // Enter · Shift+Enter
    function enter(sel, soft) {
      let d = E.doc;
      if (!sel.collapsed) d = deleteRange(d, sel.s, sel.e);
      const pos = sel.s;
      if (soft) { const r = insertRuns(d, pos, [{ ...marksBefore(d, pos), x: '\n' }]); apply(r.doc, { s: r.pos, e: r.pos }); return; }
      const B = d[pos.b];
      if (!lenOf(B) && B.t !== 'p') { // 빈 할 일에서 Enter: 목록에서 나와요
        d = clone(d);
        d[pos.b] = { t: 'p', r: [] };
        apply(d, { s: at(pos.b, 0), e: at(pos.b, 0) });
        return;
      }
      const r = splitBlock(d, pos);
      apply(r.doc, { s: r.pos, e: r.pos });
    }
    function backAtStart(bi) {
      const B = E.doc[bi];
      if (B.t !== 'p') { // 모양부터 풀어요
        const d = clone(E.doc);
        d[bi].t = 'p';
        delete d[bi].c;
        apply(d, { s: at(bi, 0), e: at(bi, 0) });
        return;
      }
      if (bi === 0) return;
      const d = clone(E.doc);
      const o = lenOf(d[bi - 1]);
      d[bi - 1].r = mergeRuns(d[bi - 1].r.concat(d[bi].r));
      d.splice(bi, 1);
      apply(d, { s: at(bi - 1, o), e: at(bi - 1, o) });
    }
    function delAtEnd(bi) {
      if (bi >= E.doc.length - 1) return;
      const d = clone(E.doc);
      const o = lenOf(d[bi]);
      d[bi].r = mergeRuns(d[bi].r.concat(d[bi + 1].r));
      d.splice(bi + 1, 1);
      apply(d, { s: at(bi, o), e: at(bi, o) });
    }

    // ----- 입력 -----
    const RULES = [[/^\[ ?\] $/, 'todo', 0], [/^\[[xX]\] $/, 'todo', 1], [/^# $/, 'h1'], [/^## $/, 'h2'], [/^### $/, 'h3'], [/^[-*] $/, 'ul']];
    function shortcut(sel) { // 줄 맨 앞에 "[] " "# " "- " 처럼 치면 모양으로 바꿔요 (Notion 마크다운 단축키)
      if (!sel || !sel.collapsed) return false;
      const B = E.doc[sel.s.b];
      if (!B || B.t !== 'p') return false;
      const head = textOf(B).slice(0, sel.s.o);
      for (const [re, t, c] of RULES) {
        if (!re.test(head)) continue;
        const d = clone(E.doc);
        d[sel.s.b].t = t;
        if (c) d[sel.s.b].c = 1;
        d[sel.s.b].r = slice(d[sel.s.b].r, sel.s.o, lenOf(d[sel.s.b]));
        apply(d, { s: at(sel.s.b, 0), e: at(sel.s.b, 0) });
        return true;
      }
      return false;
    }
    function afterInput() {
      if (E.dead) return;
      const sel = domSel();
      E.doc = parse(root);
      if (!E.composing) {
        if (E.pending && sel && sel.collapsed && sel.s.b === E.pending.pos.b && sel.s.o > E.pending.pos.o) { // 방금 친 글자에 골라 둔 서식
          let d = E.doc;
          for (const k of MK) d = mark(d, E.pending.pos, sel.s, k, E.pending.marks[k] || 0);
          E.pending = null;
          E.doc = clean(d);
          render(sel);
        } else if (shortcut(sel)) { slashClose(); return; }
        else if (root.innerHTML !== html(E.doc)) render(sel); // 브라우저가 만든 군더더기 정리
      }
      paintEmpty();
      if (E.slashArm && sel && sel.collapsed) { E.slashArm = false; E.slash = { b: sel.s.b, o: sel.s.o - 1, i: 0 }; }
      slashUpdate(sel);
      emit();
      bar.update();
    }
    on(root, 'beforeinput', (e) => {
      if (opt.readOnly) { e.preventDefault(); return; }
      const it = e.inputType || '';
      if (it === 'historyUndo') { e.preventDefault(); undo(); return; }
      if (it === 'historyRedo') { e.preventDefault(); redo(); return; }
      if (E.composing || it === 'insertCompositionText') return;
      const sel = domSel();
      if (!sel) return;
      if (it === 'insertParagraph') { e.preventDefault(); if (E.slash && slashPick()) return; enter(sel, false); return; }
      if (it === 'insertLineBreak') { e.preventDefault(); enter(sel, true); return; }
      if (it === 'formatBold' || it === 'formatItalic' || it === 'formatUnderline' || it === 'formatStrikeThrough') {
        e.preventDefault();
        toggleMark({ formatBold: 'b', formatItalic: 'i', formatUnderline: 'u', formatStrikeThrough: 's' }[it]);
        return;
      }
      if (!sel.collapsed && (it.startsWith('delete') || it === 'insertText' || it === 'insertReplacementText')) {
        e.preventDefault();
        let d = deleteRange(E.doc, sel.s, sel.e);
        let pos = sel.s;
        const tx = it.startsWith('insert') ? (e.data || (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '') : '';
        if (tx) { const r = insertRuns(d, pos, [{ ...marksBefore(E.doc, sel.s), x: tx.replace(/\r?\n/g, ' ') }]); d = r.doc; pos = r.pos; }
        apply(d, { s: pos, e: pos });
        return;
      }
      if (it === 'deleteContentBackward' && sel.s.o === 0) { e.preventDefault(); backAtStart(sel.s.b); return; }
      if (it === 'deleteContentForward' && sel.s.o === lenOf(E.doc[sel.s.b])) { e.preventDefault(); delAtEnd(sel.s.b); return; }
      if (it === 'insertText' && e.data === '/') E.slashArm = true;
      remember('typing');
    });
    on(root, 'input', () => { if (!E.composing) afterInput(); else { E.doc = parse(root); emit(); slashUpdate(domSel()); } });
    on(root, 'compositionstart', () => {
      remember('typing');
      const sel = domSel();
      if (sel && !sel.collapsed) { // 여러 줄을 고른 채 한글을 치기 시작하면 고른 걸 먼저 지워요
        E.doc = deleteRange(E.doc, sel.s, sel.e);
        render({ s: sel.s, e: sel.s });
      }
      E.composing = true;
    });
    on(root, 'compositionend', () => { E.composing = false; setTimeout(afterInput, 0); });

    on(root, 'keydown', (e) => {
      if (E.slash && !e.isComposing && slashKey(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (/^(Arrow|Home|End|Page)/.test(e.key)) E.pending = null;
        if (e.key === 'Escape') { if (bar.close()) e.preventDefault(); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return; }
      if (opt.readOnly) return;
      if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); toggleMark(k); return; }
      if (e.shiftKey && (k === 's' || e.code === 'KeyS')) { e.preventDefault(); toggleMark('s'); return; }
      if (e.key === 'Enter') { // Ctrl+Enter: 할 일 체크 (할 일이 아니면 할 일로)
        e.preventDefault();
        const sel = curSel();
        if (!sel) return;
        if (E.doc[sel.s.b].t === 'todo') {
          const d = clone(E.doc);
          const v = !d[sel.s.b].c;
          for (let i = sel.s.b; i <= sel.e.b; i++) if (d[i].t === 'todo') { if (v) d[i].c = 1; else delete d[i].c; }
          apply(d, sel);
        } else setType('todo', sel);
        return;
      }
      const dig = /^Digit([0-5])$/.exec(e.code || '');
      if (e.shiftKey && dig) { // Notion 단축키: Ctrl+Shift+0 텍스트 · 1~3 제목 · 4 할 일 · 5 글머리
        e.preventDefault();
        setType({ 0: 'p', 1: 'h1', 2: 'h2', 3: 'h3', 4: 'todo', 5: 'ul' }[dig[1]]);
      }
    });

    // 체크박스 누르기 (글자 칸 왼쪽 상자) — 커서를 옮기지 않고 체크만 바꿔요
    const boxHit = (e) => {
      const blk = e.target && e.target.closest ? e.target.closest('.nd-todo') : null;
      if (!blk || blk.parentNode !== root) return -1;
      const rc = blk.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(blk).paddingLeft) || 24;
      if (e.clientX - rc.left > pad + 2) return -1;
      return blockNodes(root).indexOf(blk);
    };
    on(root, 'mousedown', (e) => {
      E.pending = null;
      const bi = boxHit(e);
      if (bi < 0) return;
      e.preventDefault();
      toggleCheck(bi, focused() ? curSel() : null);
    });
    on(root, 'mousemove', (e) => { root.classList.toggle('on-box', boxHit(e) >= 0); });

    // 복사 · 잘라내기 · 붙여넣기: 서식은 포스트잇끼리만 그대로, 밖으로는 글자로
    function copyOut(e, cut) {
      const sel = domSel();
      if (!sel || sel.collapsed || !e.clipboardData) return;
      e.preventDefault();
      const frag = sliceDoc(E.doc, sel.s, sel.e);
      e.clipboardData.setData('text/plain', plainOf(frag));
      e.clipboardData.setData('text/html', `<div data-haru-note="${encodeURIComponent(JSON.stringify(frag))}">${html(frag)}</div>`);
      if (cut && !opt.readOnly) apply(deleteRange(E.doc, sel.s, sel.e), { s: sel.s, e: sel.s });
    }
    on(root, 'copy', (e) => copyOut(e, false));
    on(root, 'cut', (e) => copyOut(e, true));
    on(root, 'paste', (e) => {
      e.preventDefault();
      if (opt.readOnly || !e.clipboardData) return;
      const sel = domSel();
      if (!sel) return;
      let frag = null;
      const h = e.clipboardData.getData('text/html');
      const m = h && /data-haru-note="([^"]*)"/.exec(h);
      if (m) { try { frag = clean(JSON.parse(decodeURIComponent(m[1]))); } catch (_) { frag = null; } }
      if (!frag) {
        const t = e.clipboardData.getData('text/plain');
        if (!t) return;
        frag = fromText(t);
      }
      let d = E.doc;
      if (!sel.collapsed) d = deleteRange(d, sel.s, sel.e);
      const r = insertFrag(d, sel.s, frag);
      apply(r.doc, { s: r.pos, e: r.pos });
    });
    on(root, 'drop', (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault(); });

    // 고른 범위가 바뀌면 서식 막대를 맞춰요
    let selRaf = 0;
    on(document, 'selectionchange', () => {
      if (selRaf) return;
      selRaf = requestAnimationFrame(() => {
        selRaf = 0;
        if (E.dead) return;
        const sel = domSel();
        if (sel) {
          if (E.pending && cmp(E.pending.pos, sel.s) && !E.composing) {
            // 커서가 옮겨졌으면 골라 둔 서식은 버려요 (치는 중엔 afterInput 이 처리)
            if (!(sel.collapsed && sel.s.b === E.pending.pos.b && sel.s.o > E.pending.pos.o)) E.pending = null;
          }
          E.sel = sel;
        }
        if (E.slash && sel) slashUpdate(sel);
        bar.update();
      });
    });
    on(root, 'blur', () => { setTimeout(() => { if (!focused() && !bar.busy()) { bar.update(); slashClose(); } }, 120); });

    // ----- 슬래시(/) 메뉴 -----
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    let slashEl = null;
    function slashItems() {
      const q = norm(E.slash.q);
      return BLOCKS.filter((b) => !q || norm(b.name).includes(q) || b.keys.split(' ').some((k) => norm(k).startsWith(q)) || norm(b.keys).includes(q));
    }
    function slashUpdate(sel) {
      if (!E.slash) return;
      const B = E.doc[E.slash.b];
      if (!sel || !sel.collapsed || sel.s.b !== E.slash.b || !B || sel.s.o <= E.slash.o || textOf(B)[E.slash.o] !== '/') { slashClose(); return; }
      E.slash.q = textOf(B).slice(E.slash.o + 1, sel.s.o);
      if (E.slash.q.length > 14 || /^\s/.test(E.slash.q)) { slashClose(); return; }
      const items = slashItems();
      if (!items.length) { if (E.slash.q.length > 3) slashClose(); else slashDraw([]); return; }
      E.slash.i = Math.min(E.slash.i, items.length - 1);
      slashDraw(items);
    }
    function slashDraw(items) {
      if (!slashEl) {
        slashEl = document.createElement('div');
        slashEl.className = 'nd-pop nd-slash';
        slashEl.addEventListener('mousedown', (e) => e.preventDefault());
        slashEl.addEventListener('click', (e) => {
          const it = e.target.closest('[data-st]');
          if (!it) return;
          E.slash.i = Number(it.dataset.i);
          slashPick();
        });
        document.body.appendChild(slashEl);
      }
      slashEl.innerHTML = items.length
        ? `<div class="nd-pop-h">블록</div>${items.map((b, i) => `<button type="button" class="nd-it${i === E.slash.i ? ' sel' : ''}" data-st="${b.t}" data-i="${i}">${icoHTML(b.ico)}<span>${b.name}</span></button>`).join('')}`
        : '<div class="nd-pop-none">맞는 블록이 없어요</div>';
      const s = window.getSelection();
      let rc = null;
      if (s && s.rangeCount) { const r = s.getRangeAt(0).cloneRange(); rc = r.getClientRects()[0] || r.getBoundingClientRect(); }
      if (!rc || (!rc.width && !rc.height && !rc.top)) rc = root.getBoundingClientRect();
      placePop(slashEl, { left: rc.left, top: rc.top, bottom: rc.bottom || rc.top + 20 });
      const sel = slashEl.querySelector('.sel');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
    function slashClose() { E.slash = null; E.slashArm = false; if (slashEl) { slashEl.remove(); slashEl = null; } }
    function slashPick() {
      if (!E.slash) return false;
      const items = slashItems();
      const it = items[E.slash.i];
      if (!it) { slashClose(); return false; }
      const sel = domSel() || E.sel;
      const bi = E.slash.b;
      const so = E.slash.o;
      const end = sel && sel.collapsed && sel.s.b === bi && sel.s.o > so ? sel.s.o : so + 1 + (E.slash.q || '').length;
      const d = deleteRange(E.doc, at(bi, so), at(bi, Math.min(end, lenOf(E.doc[bi])))); // "/할일" 글자는 지우고
      d[bi].t = it.t; // 그 줄을 고른 블록으로
      if (it.t !== 'todo') delete d[bi].c;
      slashClose();
      apply(d, { s: at(bi, so), e: at(bi, so) });
      return true;
    }
    function slashKey(e) {
      const items = slashItems();
      if (e.key === 'ArrowDown') { e.preventDefault(); E.slash.i = (E.slash.i + 1) % Math.max(1, items.length); slashDraw(items); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); E.slash.i = (E.slash.i - 1 + items.length) % Math.max(1, items.length); slashDraw(items); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { if (!items.length) { slashClose(); return false; } e.preventDefault(); slashPick(); return true; }
      if (e.key === 'Escape') { e.preventDefault(); slashClose(); return true; }
      return false;
    }

    // ----- 서식 막대 -----
    const bar = makeBar({
      root, opt, marks, blockType, toggleMark, stepZ, format, setType, curSel, focused,
      setSel: (s) => { root.focus(); setSel(s); },
    });

    // ----- 밖에서 쓰는 것 -----
    const api = {
      el: root,
      get: () => clone(E.doc),
      // 다른 기기에서 바뀐 내용 · 처음 열 때 (되돌리기 기록은 새로)
      set(doc, keepSel) {
        const sel = keepSel && focused() ? domSel() : null;
        E.doc = clean(doc);
        E.hist = [];
        E.fut = [];
        E.pending = null;
        render(sel);
        paintEmpty();
        bar.update();
      },
      same: (doc) => sameDoc(doc, E.doc),
      focus(end) {
        root.focus();
        if (end) { const b = E.doc.length - 1; setSel({ s: at(b, lenOf(E.doc[b])), e: null }); }
      },
      focused,
      composing: () => E.composing,
      setReadOnly(v) { opt.readOnly = !!v; root.setAttribute('contenteditable', v ? 'false' : 'true'); bar.update(); },
      refresh: () => bar.update(),
      destroy() {
        E.dead = true;
        slashClose();
        bar.destroy();
        for (const [el, ev, fn, o] of listeners) el.removeEventListener(ev, fn, o);
      },
    };
    return api;
  }

  // ---------- 떠 있는 창(메뉴) 자리 잡기 ----------
  function placePop(el, rc, prefer = 'below') {
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.maxHeight = '';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    let h = el.offsetHeight;
    const below = vh - rc.bottom - 8;
    const above = rc.top - 8;
    let top;
    if ((prefer === 'below' && (below >= h || below >= above)) || (prefer === 'above' && above < h && below > above)) {
      if (h > below) { el.style.maxHeight = `${Math.max(80, below - 4)}px`; h = el.offsetHeight; }
      top = rc.bottom + 4;
    } else {
      if (h > above) { el.style.maxHeight = `${Math.max(80, above - 4)}px`; h = el.offsetHeight; }
      top = rc.top - h - 4;
    }
    const left = Math.max(6, Math.min(rc.left, vw - w - 6));
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(4, top)}px`;
  }
  function icoHTML(ico) {
    if (ico === 'chk') return `<span class="nd-ico chk">${CHECK_SVG}</span>`;
    return `<span class="nd-ico">${esc(ico)}</span>`;
  }

  // ---------- 서식 막대 (PC: 글자를 고르면 위에 떠요 · 폰: 칸 위에 늘 있어요) ----------
  function makeBar(x) {
    const dock = x.opt.dock || null;
    const el = document.createElement('div');
    el.className = `nd-bar ${dock ? 'dock' : 'float'}`;
    // 좁은 창에서는 묶음째로 다음 줄로 넘어가요 (A− 와 크기 숫자가 갈라지지 않게)
    el.innerHTML = `
      <span class="nd-grp"><button type="button" data-nd="todo" title="할 일 (Ctrl+Shift+4)">${CHECK_SVG}</button>
      <button type="button" data-nd="type" class="nd-type" title="블록 바꾸기"><span class="nd-type-v">텍스트</span><svg class="nd-caret" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></span>
      <span class="nd-grp"><button type="button" data-nd="b" title="굵게 (Ctrl+B)"><b>B</b></button>
      <button type="button" data-nd="i" title="기울임 (Ctrl+I)"><i>I</i></button>
      <button type="button" data-nd="u" title="밑줄 (Ctrl+U)"><u>U</u></button>
      <button type="button" data-nd="s" title="취소선 (Ctrl+Shift+S)"><s>S</s></button></span>
      <span class="nd-grp"><button type="button" data-nd="zdown" title="글자 작게">A−</button>
      <span class="nd-zv" title="글자 크기">17</span>
      <button type="button" data-nd="zup" class="big" title="글자 크게">A+</button></span>
      <span class="nd-grp"><button type="button" data-nd="color" class="nd-colorbtn" title="글자 색 · 배경 색"><span class="nd-a">A</span><svg class="nd-caret" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></span>`;
    if (dock) dock.appendChild(el); else document.body.appendChild(el);
    let pop = null;
    let popKind = '';
    let shown = false;
    const keep = (e) => { if (!e.target.closest('input')) e.preventDefault(); }; // 눌러도 글자 칸 커서가 안 풀리게
    el.addEventListener('mousedown', keep);
    function closePop() { if (!pop) return false; pop.remove(); pop = null; popKind = ''; el.querySelectorAll('.open').forEach((b) => b.classList.remove('open')); return true; }
    function openPop(kind, btn) {
      if (popKind === kind) { closePop(); return; }
      closePop();
      const saved = x.curSel();
      pop = document.createElement('div');
      pop.className = `nd-pop nd-${kind}-pop`;
      popKind = kind;
      btn.classList.add('open');
      if (kind === 'type') {
        const cur = x.blockType();
        pop.innerHTML = `<div class="nd-pop-h">블록 바꾸기</div>${BLOCKS.map((b) => `<button type="button" class="nd-it${b.t === cur ? ' sel' : ''}" data-pt="${b.t}">${icoHTML(b.ico)}<span>${b.name}</span></button>`).join('')}`;
      } else {
        const m = x.marks();
        const sw = (k) => [['', '기본']].concat(COLORS).map(([c, name]) => `<button type="button" class="nd-sw ${k}${c ? ` nd-${k}-${c}` : ''}${(m[k] || '') === c ? ' sel' : ''}" data-pc="${k}" data-c="${c}" title="${name}${k === 'bg' ? ' 배경' : ''}"><span>A</span></button>`).join('');
        pop.innerHTML = `<div class="nd-pop-h">글자 색</div><div class="nd-sws">${sw('fc')}</div><div class="nd-pop-h">배경 색</div><div class="nd-sws">${sw('bg')}</div>`;
      }
      pop.addEventListener('mousedown', keep);
      pop.addEventListener('click', (e) => {
        const t = e.target.closest('[data-pt]');
        const c = e.target.closest('[data-pc]');
        if (saved && !x.focused()) x.setSel(saved);
        if (t) { x.setType(t.dataset.pt, saved || undefined); closePop(); }
        else if (c) { x.format(c.dataset.pc, c.dataset.c || ''); closePop(); }
      });
      document.body.appendChild(pop);
      const rc = btn.getBoundingClientRect();
      placePop(pop, rc, dock ? 'below' : 'below');
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nd]');
      if (!b || b.disabled) return;
      const k = b.dataset.nd;
      if (k === 'type' || k === 'color') { openPop(k, b); return; }
      closePop();
      if (k === 'todo') x.setType('todo');
      else if (k === 'zdown') x.stepZ(-1);
      else if (k === 'zup') x.stepZ(1);
      else x.toggleMark(k);
    });
    const outside = (e) => { if (pop && !pop.contains(e.target) && !el.contains(e.target)) closePop(); };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('touchstart', outside, { capture: true, passive: true });

    function update() {
      const sel = x.curSel();
      const ro = !!x.opt.readOnly;
      const live = !!sel && x.focused();
      if (!dock) { // 떠 있는 막대: 글자를 골랐을 때만
        const want = live && !sel.collapsed && !ro;
        if (!want && !pop) { if (shown) { el.classList.remove('show'); shown = false; } return; }
        if (!want) return;
      }
      el.classList.toggle('ro', ro);
      const m = x.marks();
      for (const k of ['b', 'i', 'u', 's']) el.querySelector(`[data-nd="${k}"]`).classList.toggle('on', !!m[k]);
      const t = x.blockType() || 'p';
      el.querySelector('[data-nd="todo"]').classList.toggle('on', t === 'todo');
      const bt = BLOCKS.find((b) => b.t === t);
      el.querySelector('.nd-type-v').textContent = bt ? bt.name.replace(' 목록', '') : '텍스트';
      const base = (typeof x.opt.base === 'function' ? x.opt.base() : 17) || 17;
      const zv = el.querySelector('.nd-zv');
      zv.textContent = m.z === 'mix' ? '–' : String(Math.round(base * (m.z || 1)));
      el.querySelector('[data-nd="zdown"]').disabled = m.z !== 'mix' && (m.z || 1) <= ZS[0];
      el.querySelector('[data-nd="zup"]').disabled = m.z !== 'mix' && (m.z || 1) >= ZS[ZS.length - 1];
      const a = el.querySelector('.nd-a');
      a.className = `nd-a${m.fc && m.fc !== 'mix' ? ` nd-fc-${m.fc}` : ''}${m.bg && m.bg !== 'mix' ? ` nd-bg-${m.bg}` : ''}`;
      if (!dock) {
        const s = window.getSelection();
        if (!s || !s.rangeCount) return;
        const rc = s.getRangeAt(0).getBoundingClientRect();
        el.classList.add('show');
        shown = true;
        placePop(el, rc, 'above');
      }
    }
    return {
      update,
      close: closePop,
      busy: () => !!pop,
      destroy() {
        closePop();
        el.remove();
        document.removeEventListener('mousedown', outside, true);
        document.removeEventListener('touchstart', outside, { capture: true, passive: true });
      },
    };
  }

  // 보기 전용 (폰 목록 카드 미리보기)
  const viewHTML = (doc) => clean(doc).map(blockHTML).join('');

  return { TYPES, COLORS, ZS, clean, plainOf, fromText, docOf, isEmpty, sameDoc, html: viewHTML, parse, editor, _ops: { deleteRange, insertFrag, insertRuns, splitBlock, mark, marksAt, sliceDoc, slice } };
});
