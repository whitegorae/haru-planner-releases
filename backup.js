'use strict';

/* =========================================================================
 * 내 데이터 백업 · 원본 사진 보관 (데스크톱 · 폰 같이 써요)
 *
 *  하루플래너 열쇠 (계정마다 하나)
 *   - 처음 쓸 때 무작위 열쇠(AES-256)를 만들고, 그 열쇠를 "하루플래너 비밀번호"로 잠가서(PBKDF2-SHA256 31만 번)
 *     서버 표 haru_keys 에 저장해요. 잠근 열쇠라서 서버 · 개발자도 열 수 없어요.
 *   - 로그인할 때 비밀번호로 열어서 이 기기에 기억해요. 비밀번호를 바꾸면 같은 열쇠를 새 비밀번호로 다시 잠가요.
 *   - 드라이브에 올리는 파일(원본 사진 · 백업)은 모두 이 열쇠로 암호화해요.
 *     파일 머리에 "비밀번호로 잠근 열쇠"도 같이 넣어서, 서버가 없어져도 그때의 하루플래너 비밀번호만 있으면 열려요.
 *
 *  원본 사진
 *   - 큰 사진(원본)은 각자 구글 드라이브의 숨김 앱 폴더 안 "HaruPlanner 원본 사진" 폴더에 (orig-<id>.haru)
 *   - 작은 사진(달력 · 위젯용)은 지금처럼 Supabase 저장소에
 *   - 예전에 Supabase 에 올린 원본은 드라이브를 연결하면 자동으로 옮기고, Supabase 쪽 원본은 지워요
 *
 *  백업
 *   - 실시간: 무엇이든 바뀌면 몇 초 뒤 HaruPlanner-live.haru 를 덮어쓰고, 하루 한 번 날짜 보관본(최근 14개)
 *   - 되살리기는 "합치기": 지금 없는 항목만 다시 넣어요
 * ========================================================================= */

const HaruBackup = (() => {
  const MAGIC = 'HaruPlanner-backup';
  const ITER = 310000;
  const KINDS = ['lists', 'tasks', 'ddays', 'sessions', 'notes', 'photos', 'jobs', 'shifts'];
  const LIVE_NAME = 'HaruPlanner-live.haru';
  const NEED_KEY = '하루플래너 비밀번호를 한 번 넣어 주세요 (설정 → 백업)';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
  const randB64 = (n) => b64(randBytes(n));
  const codeErr = (msg, code) => Object.assign(new Error(msg), { code });

  // ---------- 암호 도구 ----------
  // 비밀번호 → 잠금 열쇠 (31만 번 계산이라 같은 비밀번호 · 소금이면 한 번만)
  const pwKeys = new Map();
  function keyFor(password, saltB64, iter) {
    const k = `${iter}|${saltB64}|${password}`;
    if (!pwKeys.has(k)) {
      const p = crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey'])
        .then((base) => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
      p.catch(() => pwKeys.delete(k));
      if (pwKeys.size > 20) pwKeys.clear();
      pwKeys.set(k, p);
    }
    return pwKeys.get(k);
  }
  const rawKeys = new Map();
  function aesKey(raw) {
    const k = b64(raw);
    if (!rawKeys.has(k)) { if (rawKeys.size > 10) rawKeys.clear(); rawKeys.set(k, crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])); }
    return rawKeys.get(k);
  }
  const aesEnc = async (key, iv, bytes) => new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const aesDec = async (key, iv, bytes) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes));

  // ---------- 하루플래너 열쇠 ----------
  const kcli = () => (typeof Cloud !== 'undefined' && Cloud.client && Cloud.client()) || null;
  const uid = () => { const u = typeof Cloud !== 'undefined' && Cloud.user && Cloud.user(); return (u && u.id) || ''; };
  const DK = (u) => `haru-key:${u}`;
  // 이 기기에 기억한 열쇠: { raw(b64), wrap: { salt, iter, iv, key } }
  function myKey() {
    const u = uid();
    if (!u) return null;
    try { const o = JSON.parse(localStorage.getItem(DK(u))); return o && o.raw && o.wrap ? o : null; } catch (_) { return null; }
  }
  function rememberKey(raw, wrap) {
    const u = uid();
    if (!u) return;
    try { localStorage.setItem(DK(u), JSON.stringify({ raw: b64(raw), wrap: { salt: wrap.salt, iter: wrap.iter, iv: wrap.iv, key: wrap.key } })); } catch (_) { /* 무시 */ }
    notify();
  }
  const keyReady = () => !!myKey();
  function forgetKey() { const u = uid(); if (u) { try { localStorage.removeItem(DK(u)); } catch (_) { /* 무시 */ } } }
  async function wrapKey(raw, password) {
    const salt = randB64(16);
    const iv = randBytes(12);
    const kek = await keyFor(password, salt, ITER);
    return { salt, iter: ITER, iv: b64(iv), key: b64(await aesEnc(kek, iv, raw)) };
  }
  async function unwrapKey(w, password) {
    const kek = await keyFor(password, w.salt, Number(w.iter) || ITER);
    try { return await aesDec(kek, unb64(w.iv), unb64(w.key)); } catch (_) { throw codeErr('비밀번호가 맞지 않아요', 'bad-password'); }
  }
  const keyDbErr = (e) => new Error(/relation|does not exist|42P01|PGRST20|schema cache/i.test(String(e && e.message)) ? '서버 준비가 아직 안 됐어요 (deploy-gcal)' : (e && e.message) || String(e));
  async function keyRow() {
    const c = kcli();
    if (!c || !uid()) throw new Error('로그인이 필요해요');
    const { data, error } = await c.from('haru_keys').select('salt,iter,iv,key').eq('user_id', uid()).maybeSingle();
    if (error) throw keyDbErr(error);
    return data || null;
  }
  async function keyWrite(w, insert) {
    const c = kcli();
    const row = { user_id: uid(), salt: w.salt, iter: w.iter, iv: w.iv, key: w.key, updated_at: new Date().toISOString() };
    const { error } = insert ? await c.from('haru_keys').insert(row) : await c.from('haru_keys').update(row).eq('user_id', uid());
    if (error) throw Object.assign(keyDbErr(error), { dup: /duplicate|23505|conflict/i.test(`${error.code} ${error.message}`) });
  }
  const keyExists = async () => !!(await keyRow());
  // 비밀번호로 열쇠 열기 (없으면 새로 만들어요). 맞지 않으면 bad-password
  async function keyUnlock(password) {
    if (!password) throw codeErr('비밀번호를 넣어 주세요', 'bad-password');
    const row = await keyRow();
    if (!row) {
      const raw = randBytes(32);
      const w = await wrapKey(raw, password);
      try { await keyWrite(w, true); } catch (e) {
        if (!e.dup) throw e;
        return keyUnlock(password); // 다른 기기가 먼저 만들었어요 → 그걸로 열기
      }
      rememberKey(raw, w);
      return { created: true };
    }
    const raw = await unwrapKey(row, password);
    rememberKey(raw, row);
    return { ok: true };
  }
  // 로그인 · 가입 직후 (그 비밀번호가 지금 하루플래너 비밀번호예요)
  async function keyOnLogin(password) {
    if (!password || !kcli() || !uid()) return { ok: false };
    try {
      return await keyUnlock(password);
    } catch (e) {
      if (e.code !== 'bad-password') return { ok: false, error: e.message };
      // 다른 곳에서 비밀번호를 바꿨는데, 이 기기는 열쇠를 갖고 있으면 → 새 비밀번호로 다시 잠가요
      const mine = myKey();
      if (mine) {
        try { const w = await wrapKey(unb64(mine.raw), password); await keyWrite(w, false); rememberKey(unb64(mine.raw), w); return { ok: true, rewrapped: true }; } catch (e2) { return { ok: false, error: e2.message }; }
      }
      return { ok: false, needOld: true };
    }
  }
  // 비밀번호를 바꾼 직후: 같은 열쇠를 새 비밀번호로 다시 잠가요 (그래서 예전 사진 · 백업도 계속 열려요)
  async function keyOnPasswordChange(newPassword) {
    const mine = myKey();
    if (!mine) return keyOnLogin(newPassword);
    try {
      const w = await wrapKey(unb64(mine.raw), newPassword);
      const row = await keyRow();
      await keyWrite(w, !row);
      rememberKey(unb64(mine.raw), w);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ---------- 파일 암호화 ----------
  // v2: 하루플래너 열쇠로 암호화 + 머리에 "비밀번호로 잠근 열쇠" (비밀번호만으로도 열려요)
  async function sealBytes(bytes, head) {
    const mine = myKey();
    if (!mine) throw codeErr(NEED_KEY, 'need-key');
    const iv = randBytes(12);
    const body = await aesEnc(await aesKey(unb64(mine.raw)), iv, bytes);
    const w = mine.wrap;
    return JSON.stringify({ app: MAGIC, v: 2, ...head, kdf: { name: 'PBKDF2-SHA256', iter: w.iter, salt: w.salt }, wrap: { iv: w.iv, key: w.key }, cipher: { name: 'AES-256-GCM', iv: b64(iv) }, data: b64(body) });
  }
  // v1(예전): 비밀번호로 바로 암호화 — 시험 · 예전 파일 호환용
  async function sealWithPassword(bytes, password, head) {
    if (!password || String(password).length < 4) throw new Error('비밀번호는 4자 이상이어야 해요');
    const salt = randB64(16);
    const iv = randBytes(12);
    const body = await aesEnc(await keyFor(password, salt, ITER), iv, bytes);
    return JSON.stringify({ app: MAGIC, v: 1, ...head, kdf: { name: 'PBKDF2-SHA256', iter: ITER, salt }, cipher: { name: 'AES-256-GCM', iv: b64(iv) }, data: b64(body) });
  }
  // 열기: 이 기기의 열쇠 먼저 → 안 되면 비밀번호로
  async function openBytes(o, password) {
    const iv = unb64(o.cipher.iv);
    const data = unb64(o.data);
    if (o.wrap) {
      const mine = myKey();
      if (mine) { try { return await aesDec(await aesKey(unb64(mine.raw)), iv, data); } catch (_) { /* 다른 열쇠로 만든 파일 */ } }
      if (!password) throw codeErr('이 파일을 만들 때의 하루플래너 비밀번호가 필요해요', 'need-password');
      const raw = await unwrapKey({ salt: o.kdf.salt, iter: o.kdf.iter, iv: o.wrap.iv, key: o.wrap.key }, password);
      try { return await aesDec(await aesKey(raw), iv, data); } catch (_) { throw codeErr('파일이 손상됐어요', 'bad-file'); }
    }
    if (!password) throw codeErr('이 백업을 만들 때 정한 비밀번호가 필요해요', 'need-password');
    try { return await aesDec(await keyFor(password, o.kdf.salt, Number(o.kdf.iter) || ITER), iv, data); } catch (_) { throw codeErr('비밀번호가 맞지 않아요', 'bad-password'); }
  }

  // 지금 데이터 → 백업 내용 (평문)
  function snapshot(data, appVersion) {
    const d = {};
    for (const k of KINDS) d[k] = JSON.parse(JSON.stringify(data[k] || []));
    d.settings = JSON.parse(JSON.stringify(data.settings || {}));
    return { app: MAGIC, v: 1, at: Date.now(), version: appVersion || '', data: d };
  }
  const counts = (d) => Object.fromEntries(KINDS.map((k) => [k, (d[k] || []).length]));
  // 겉에는 언제 만든 백업인지 · 몇 개인지만 (내용은 전부 암호문)
  const lock = (snap, password) => {
    const head = { at: snap.at, version: snap.version, counts: counts(snap.data) };
    const bytes = enc.encode(JSON.stringify(snap));
    return password ? sealWithPassword(bytes, password, head) : sealBytes(bytes, head);
  };
  function peek(text) {
    let o;
    try { o = JSON.parse(text); } catch (_) { throw new Error('하루플래너 백업 파일이 아니에요'); }
    if (!o || o.app !== MAGIC || !o.data || !o.kdf || !o.cipher) throw new Error('하루플래너 백업 파일이 아니에요');
    return o;
  }
  async function unlock(text, password) {
    const o = peek(text);
    if (o.kind === 'photo') throw new Error('사진 파일이에요. 백업 목록에서 되살리면 사진도 같이 돌아와요.');
    const snap = JSON.parse(dec.decode(await openBytes(o, password)));
    if (!snap || snap.app !== MAGIC || !snap.data) throw new Error('백업 내용이 올바르지 않아요');
    return snap;
  }

  // 사진 한 장(큰 사진 + 작은 사진) → 암호문 하나. 경로도 안쪽(암호문)에 넣어요
  async function lockPhoto(photo, full, thumb, password, type) {
    const meta = enc.encode(JSON.stringify({ id: photo.id, date: photo.date, path: photo.path || '', thumb: photo.thumb || '', type: type || 'image/jpeg' }));
    const t = thumb || new Uint8Array(0);
    const buf = new Uint8Array(8 + meta.length + full.length + t.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, meta.length);
    buf.set(meta, 4);
    dv.setUint32(4 + meta.length, full.length);
    buf.set(full, 8 + meta.length);
    buf.set(t, 8 + meta.length + full.length);
    const head = { kind: 'photo', at: Date.now() };
    return password ? sealWithPassword(buf, password, head) : sealBytes(buf, head);
  }
  async function unlockPhoto(text, password) {
    const o = peek(text);
    const buf = await openBytes(o, password);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const ml = dv.getUint32(0);
    const meta = JSON.parse(dec.decode(buf.subarray(4, 4 + ml)));
    const fl = dv.getUint32(4 + ml);
    const full = buf.slice(8 + ml, 8 + ml + fl);
    const thumb = buf.slice(8 + ml + fl);
    return { meta, full, thumb: thumb.length ? thumb : null };
  }
  const photoName = (id) => `photo-${String(id).replace(/[^\w-]/g, '_')}.haru`;

  // 되살리기(합치기): 지금 없는 항목만 넣어요. 무엇을 몇 개 넣을지 미리 볼 수도 있어요 (dry)
  function merge(data, snap, { dry = false } = {}) {
    const added = {};
    for (const k of KINDS) {
      const have = new Set((data[k] || []).map((x) => x && x.id));
      const add = (snap.data[k] || []).filter((x) => x && x.id && !have.has(x.id));
      added[k] = add.length;
      if (!dry && add.length) data[k] = [...(data[k] || []), ...JSON.parse(JSON.stringify(add))];
    }
    return added;
  }

  const fileName = (at = Date.now()) => {
    const d = new Date(at);
    const p = (n) => String(n).padStart(2, '0');
    return `HaruPlanner-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.haru`;
  };
  const isLive = (n) => n === LIVE_NAME;
  const isDaily = (n) => /^HaruPlanner-backup-/.test(n || '');
  const isPhotoFile = (n) => /^photo-/.test(n || '');
  const isOrigFile = (n) => /^orig-/.test(n || '');
  // 이 기기에 파일로 저장 / 파일 고르기
  function saveFile(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name || fileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function pickFile() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.haru,application/json,.json';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f ? await f.text() : null); });
      inp.click();
    });
  }

  // ---------- 구글 드라이브 (서버 함수 gdrive 를 거쳐요: 구글 토큰은 서버에만, 서버는 암호문만 봐요) ----------
  const cli = () => (typeof Cloud !== 'undefined' && Cloud.isActive() ? Cloud.client() : null);
  async function drive(action, extra = {}) {
    const c = cli();
    if (!c) throw new Error('로그인이 필요해요');
    const { data, error } = await c.functions.invoke('gdrive', { body: { action, ...extra } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; if (j.connected === false) setDriveOn(false); } catch (_) { /* 무시 */ }
      if (/not found|404|Failed to send/i.test(msg) && !/사진|드라이브에/.test(msg)) msg = '서버 준비가 아직 안 됐어요 (deploy-gcal)';
      throw new Error(msg);
    }
    return data;
  }
  // 드라이브 연결 여부를 이 기기에 잠깐 기억해요 (사진 올릴 때마다 묻지 않게)
  const DON = (u) => `haru-drive-on:${u}`;
  function setDriveOn(on) { const u = uid(); if (u) { try { localStorage.setItem(DON(u), JSON.stringify({ on: !!on, at: Date.now() })); } catch (_) { /* 무시 */ } } }
  const driveStatus = () => drive('status').then((r) => { setDriveOn(r && r.connected); return r; });
  async function driveOn() {
    const u = uid();
    if (!u || !cli()) return false;
    let c = null;
    try { c = JSON.parse(localStorage.getItem(DON(u))); } catch (_) { c = null; }
    if (c && Date.now() - c.at < 6 * 3600 * 1000) return c.on;
    try { return !!(await driveStatus()).connected; } catch (_) { return false; }
  }
  const driveList = () => drive('list');
  const driveUsage = () => drive('usage'); // 개발자 모드: 드라이브 사용량
  const driveAdminUsage = () => drive('admin-usage'); // 개발자 모드(관리자만): 모든 사용자의 드라이브 사용량
  const driveUpload = (text, name) => drive('upload', { name: name || fileName(), content: text });
  const drivePut = (text, name) => drive('put', { name, content: text });
  const driveDownload = (id) => drive('download', { id }).then((r) => r.content);
  const driveDelete = (id) => drive('delete', { id });
  const driveDisconnect = () => drive('disconnect').then((r) => { setDriveOn(false); return r; });
  // 일정 첨부파일: 드라이브와 바로 주고받을 짧은 열쇠 (앱 전용 숨김 폴더만 쓸 수 있어요) — attach.js
  const driveFileToken = (quota) => drive('file-token', { quota: !!quota })
    .then((r) => { setDriveOn(true); return r; })
    .catch((e) => {
      const m = e.message || '';
      throw new Error(/알 수 없는 동작/.test(m) ? '서버 준비가 아직 안 됐어요 (deploy-gcal)' : /연결되지 않았|연결이 풀렸/.test(m) ? '파일을 넣으려면 설정 › 백업에서 구글 드라이브를 연결해 주세요' : m);
    });
  // 구글 동의 화면 열기 (캘린더 연동과 같은 방식, purpose=drive)
  async function driveConnect(openUrl) {
    const c = cli();
    const u = typeof Cloud !== 'undefined' && Cloud.user();
    if (!c || !u) throw new Error('먼저 로그인해 주세요');
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    const nonce = Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
    const { error } = await c.from('gcal_oauth_state').insert({ nonce, user_id: u.id, purpose: 'drive' });
    if (error) throw new Error(/relation|does not exist|42P01|PGRST20|schema cache|column/i.test(error.message) ? '서버 준비가 아직 안 됐어요 (deploy-gcal)' : error.message);
    const cfg = Cloud.config();
    const base = String((cfg && cfg.url) || c.supabaseUrl || '').replace(/\/$/, '');
    openUrl(`${base}/functions/v1/gcal-auth?nonce=${nonce}`);
  }

  // ---------- Supabase 저장소 ----------
  async function storageGet(path) {
    const c = cli();
    const { data, error } = await c.storage.from('photos').download(path);
    if (error || !data) throw new Error((error && error.message) || '사진을 받을 수 없어요');
    return new Uint8Array(await data.arrayBuffer());
  }
  async function storagePut(path, bytes) {
    const c = cli();
    const { error } = await c.storage.from('photos').upload(path, new Blob([bytes], { type: 'image/jpeg' }), { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (error && !/exist|duplicate|409/i.test(String(error.message || error.statusCode || error))) throw new Error(error.message || '사진을 올릴 수 없어요');
  }
  async function storageRemove(paths) {
    const c = cli();
    if (!c || !paths.length) return;
    await c.storage.from('photos').remove(paths);
  }

  // ---------- 원본 사진 (드라이브의 "HaruPlanner 원본 사진" 폴더) ----------
  // 새 사진의 원본을 어디에 둘지: 드라이브가 연결돼 있고 이 기기에 열쇠가 있으면 드라이브
  const photoToDrive = async () => keyReady() && (await driveOn());
  async function drivePhotoPut(photo, fullBytes, type) {
    const text = await lockPhoto({ id: photo.id, date: photo.date, path: '', thumb: photo.thumb }, fullBytes, null, undefined, type);
    const r = await drive('photo-put', { id: photo.id, content: text });
    if (!r || !r.file || !r.file.id) throw new Error('원본 사진을 드라이브에 올리지 못했어요');
    return r.file;
  }
  const drivePhotoDelete = (fileId) => drive('photo-del', { fileId });
  // 원본 보기: 받아서 열쇠로 풀고 → 이 기기에 기억 (메모리 + 브라우저 캐시)
  const origUrls = new Map();
  const ORIG_CACHE = 'haru-orig-v1';
  const cacheReq = (fileId) => `https://haru-orig.local/${encodeURIComponent(fileId)}`;
  const origCached = (p) => (p && p.drive && origUrls.get(p.drive)) || null;
  function keepUrl(fileId, blob) {
    const u = URL.createObjectURL(blob);
    origUrls.set(fileId, u);
    if (origUrls.size > 40) { const [k, v] = origUrls.entries().next().value; URL.revokeObjectURL(v); origUrls.delete(k); }
    return u;
  }
  const origLoading = new Map();
  function photoOriginalUrl(p) {
    if (!p || !p.drive) return Promise.reject(new Error('원본이 드라이브에 없어요'));
    const have = origUrls.get(p.drive);
    if (have) return Promise.resolve(have);
    if (origLoading.has(p.drive)) return origLoading.get(p.drive);
    const job = (async () => {
      try {
        if (typeof caches !== 'undefined') {
          const c = await caches.open(ORIG_CACHE);
          const hit = await c.match(cacheReq(p.drive));
          if (hit) return keepUrl(p.drive, await hit.blob());
        }
      } catch (_) { /* 캐시를 못 쓰는 곳이면 그냥 받아요 */ }
      if (!keyReady()) throw codeErr(NEED_KEY, 'need-key');
      const r = await drive('photo-get', { fileId: p.drive });
      const got = await unlockPhoto(r.content);
      const type = /^image\/[\w.+-]+$/.test((got.meta && got.meta.type) || '') ? got.meta.type : 'image/jpeg';
      const blob = new Blob([got.full], { type });
      try { if (typeof caches !== 'undefined') await (await caches.open(ORIG_CACHE)).put(cacheReq(p.drive), new Response(blob, { headers: { 'Content-Type': type } })); } catch (_) { /* 무시 */ }
      return keepUrl(p.drive, blob);
    })();
    origLoading.set(p.drive, job);
    job.finally(() => origLoading.delete(p.drive)).catch(() => {});
    return job;
  }
  async function clearOriginals() {
    for (const u of origUrls.values()) URL.revokeObjectURL(u);
    origUrls.clear();
    try { if (typeof caches !== 'undefined') await caches.delete(ORIG_CACHE); } catch (_) { /* 무시 */ }
  }

  // 예전에 Supabase 에 올린 원본을 드라이브로 옮겨요 (옮기고 확인한 뒤 Supabase 쪽 원본은 지워요)
  const move = { running: false, fail: new Map(), getData: null, onChanged: null, moved: 0 };
  function photoMoveSetup(getData, onChanged) { move.getData = getData; move.onChanged = onChanged; }
  // 이미 드라이브로 옮긴 사진인데 Supabase 에 원본이 남아 있으면 지워요 (옮긴 직후 앱이 닫혀서 못 지운 경우)
  const cleaned = new Set();
  async function cleanMoved(data) {
    const list = (data.photos || []).filter((p) => p && p.drive && !p.path && /_t\.jpg$/.test(p.thumb || '') && !cleaned.has(p.id));
    if (!list.length) return;
    try {
      for (let i = 0; i < list.length; i += 100) await storageRemove(list.slice(i, i + 100).map((p) => p.thumb.replace(/_t\.jpg$/, '.jpg')));
      list.forEach((p) => cleaned.add(p.id));
    } catch (_) { /* 다음에 */ }
  }
  async function photoMoveTick() {
    if (move.running || !move.getData) return 0;
    const data = move.getData();
    if (!data || !cli()) return 0;
    await cleanMoved(data);
    const todo = (data.photos || []).filter((p) => p && p.id && p.path && !p.drive && (move.fail.get(p.id) || 0) < 3);
    if (!todo.length || !(await photoToDrive())) return 0;
    move.running = true;
    const done = [];
    try {
      for (const p of todo.slice(0, 8)) {
        try {
          const bytes = await storageGet(p.path);
          const f = await drivePhotoPut(p, bytes);
          if (!(Number(f.size) >= bytes.length)) throw new Error('올라간 크기가 맞지 않아요');
          const cur = (move.getData().photos || []).find((x) => x.id === p.id);
          if (!cur || cur.path !== p.path) { drivePhotoDelete(f.id).catch(() => {}); continue; } // 그사이 지워졌거나 바뀌었어요
          const old = cur.path;
          cur.drive = f.id;
          cur.path = '';
          done.push(old);
        } catch (e) {
          if (/연결|로그인|서버 준비|비밀번호/.test(e.message || '')) break;
          move.fail.set(p.id, (move.fail.get(p.id) || 0) + 1);
        }
      }
      if (done.length) {
        move.moved += done.length;
        if (move.onChanged) move.onChanged();
        // 바뀐 사진 목록이 다른 기기로 퍼진 뒤에 Supabase 쪽 원본을 지워요
        setTimeout(() => { storageRemove(done).catch(() => {}); }, 8000);
        notify();
      }
    } finally { move.running = false; }
    return todo.length - done.length;
  }
  const photoStats = (data) => {
    const ps = (data && data.photos) || [];
    return { total: ps.length, onDrive: ps.filter((p) => p && p.drive).length, waiting: ps.filter((p) => p && p.path && !p.drive && (move.fail.get(p.id) || 0) < 3).length };
  };

  // 되살린 사진 목록의 실제 사진 파일을 드라이브 백업에서 받아 저장소에 다시 넣어요 (Supabase 에 원본이 있던 사진)
  async function restorePhotoFiles(photos, passwords, onStep) {
    const res = { ok: 0, missing: 0, badPw: 0 };
    const list = (photos || []).filter((p) => p && p.path && !p.drive); // 드라이브 원본은 그대로 있어요
    if (!list.length) return res;
    const { files = [] } = await driveList();
    const byName = new Map(files.filter((f) => isPhotoFile(f.name)).map((f) => [f.name, f.id]));
    const pws = [undefined, ...new Set((passwords || []).filter(Boolean))];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (onStep) onStep(i + 1, list.length);
      const id = byName.get(photoName(p.id));
      if (!id) { res.missing++; continue; }
      let got = null;
      try {
        const text = await driveDownload(id);
        for (const pw of pws) { try { got = await unlockPhoto(text, pw); break; } catch (_) { /* 다음 */ } }
      } catch (_) { res.missing++; continue; }
      if (!got) { res.badPw++; continue; }
      await storagePut(p.path, got.full);
      if (p.thumb && got.thumb) await storagePut(p.thumb, got.thumb);
      res.ok++;
    }
    return res;
  }

  // ---------- 실시간 자동 백업 (이 기기에서 켠 경우만) ----------
  // 설정: { on, hash, counts, liveAt, last(하루 보관본), gone{사진이름: 처음 없어진 때} }
  const AUTO_KEY = 'haru-backup-auto';
  const IDLE = 4000; // 마지막으로 바뀌고 4초 뒤
  const MAX_WAIT = 20000; // 계속 바뀌어도 20초마다는 올려요
  const DAY_KEEP = 14;
  const PHOTO_GRACE = 30 * 24 * 3600 * 1000; // 앱에서 지운 사진의 백업은 30일 뒤에 드라이브에서도 지워요
  const autoCfg = () => { try { return JSON.parse(localStorage.getItem(AUTO_KEY)) || {}; } catch (_) { return {}; } };
  const setAuto = (o) => { try { if (o) localStorage.setItem(AUTO_KEY, JSON.stringify(o)); else localStorage.removeItem(AUTO_KEY); } catch (_) { /* 무시 */ } live.files = null; notify(); };
  const patchAuto = (o) => { const a = autoCfg(); if (a.on) { try { localStorage.setItem(AUTO_KEY, JSON.stringify({ ...a, ...o })); } catch (_) { /* 무시 */ } } };
  const live = { timer: 0, first: 0, running: false, again: false, getData: null, ver: '', files: null, filesUser: '', err: '', busy: '', listeners: new Set(), retry: 0, photoFail: new Map() };
  function notify() { live.listeners.forEach((f) => { try { f(); } catch (_) { /* 무시 */ } }); }
  const onLive = (f) => { live.listeners.add(f); return () => live.listeners.delete(f); };
  const liveState = () => ({ busy: live.busy, err: live.err, running: live.running });

  async function sha(text) { return b64(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

  // 데이터가 바뀔 때마다 불러 주세요 (앱 · 다른 기기에서 온 변경 모두). 잠깐 모았다가 한 번에 올려요
  function liveSoon(getData, appVersion) {
    if (getData) live.getData = getData;
    if (appVersion !== undefined) live.ver = appVersion;
    if (!autoCfg().on) return;
    const now = Date.now();
    if (!live.first) live.first = now;
    clearTimeout(live.timer);
    live.timer = setTimeout(liveRun, Math.max(0, Math.min(IDLE, live.first + MAX_WAIT - now)));
  }
  async function liveRun() {
    clearTimeout(live.timer);
    live.timer = 0;
    live.first = 0;
    if (live.running) { live.again = true; return; }
    live.running = true;
    let ok = false;
    try { live.again = !!(await liveOnce()); live.err = ''; live.retry = 0; ok = true; } catch (e) {
      live.err = (e && e.message) || String(e);
      // 연결이 끊겼거나 서버가 없거나 열쇠가 없으면 기다려요. 인터넷 문제면 잠시 뒤 다시
      if (!/연결|로그인|서버 준비|비밀번호/.test(live.err)) { live.retry = Math.min(6, live.retry + 1); setTimeout(() => liveSoon(), 30000 * live.retry); }
    } finally {
      live.running = false;
      live.busy = '';
      notify();
      if (ok && live.again) { live.again = false; liveSoon(); }
    }
  }
  // 한 번 올리기. 더 할 일(남은 사진)이 있으면 true
  async function liveOnce() {
    const a = autoCfg();
    if (!a.on || !cli()) return false;
    if (!keyReady()) throw codeErr(NEED_KEY, 'need-key');
    const data = live.getData && live.getData();
    if (!data) return false;
    const c = counts(data);
    const total = Object.values(c).reduce((x, y) => x + y, 0);
    if (!total) return false; // 빈 데이터(불러오는 중 등)로 백업을 덮지 않아요
    const me = uid();
    if (!live.files || live.filesUser !== me) { live.files = (await driveList()).files || []; live.filesUser = me; }
    const now = Date.now();

    // 1) 데이터: 바뀌었을 때만 HaruPlanner-live.haru 를 덮어써요
    const snap = snapshot(data, live.ver);
    const hash = await sha(`${me}|${myKey().wrap.key}|${JSON.stringify(snap.data)}`);
    let text = null;
    if (hash !== a.hash) {
      live.busy = '드라이브에 올리는 중…';
      notify();
      text = await lock(snap);
      // 갑자기 많이 줄었으면(지워짐 사고 대비) 덮기 전에 이전 최신본을 날짜 보관본으로 남겨요
      const prev = a.counts ? Object.values(a.counts).reduce((x, y) => x + y, 0) : 0;
      const old = live.files.find((f) => isLive(f.name));
      if (old && prev >= 10 && total < prev * 0.7) {
        try { const t = await driveDownload(old.id); const f = (await driveUpload(t, fileName(now - 60000))).file; if (f) live.files.push(f); } catch (_) { /* 그래도 계속 */ }
      }
      const f = (await drivePut(text, LIVE_NAME)).file;
      if (f) live.files = [f, ...live.files.filter((x) => !isLive(x.name))];
      patchAuto({ hash, counts: c, liveAt: Date.now() });
    }

    // 2) 하루 한 번 날짜 붙은 보관본 (최근 14개만)
    if (!a.last || now - a.last > 22 * 3600 * 1000) {
      live.busy = '오늘 보관본 만드는 중…';
      notify();
      const f = (await driveUpload(text || await lock(snap), fileName(now))).file;
      if (f) live.files.push(f);
      patchAuto({ last: now });
      const daily = live.files.filter((x) => isDaily(x.name)).sort((x, y) => String(y.createdTime).localeCompare(String(x.createdTime)));
      for (const old of daily.slice(DAY_KEEP)) { try { await driveDelete(old.id); live.files = live.files.filter((x) => x.id !== old.id); } catch (_) { /* 다음에 */ } }
    }

    // 3) 원본이 아직 Supabase 에 있는 사진은 드라이브에 백업 사본을 (원본이 드라이브에 있는 사진은 그 자체로 드라이브에 있어요)
    const onDrive = new Map(live.files.filter((x) => isPhotoFile(x.name)).map((x) => [x.name, x.id]));
    const photos = (data.photos || []).filter((p) => p && p.id && p.path && !p.drive);
    const todo = photos.filter((p) => !onDrive.has(photoName(p.id)) && (live.photoFail.get(p.id) || 0) < 3);
    let n = 0;
    for (const p of todo.slice(0, 10)) {
      live.busy = `사진 백업 중… (${++n}/${todo.length})`;
      notify();
      try {
        const full = await storageGet(p.path);
        const thumb = p.thumb ? await storageGet(p.thumb).catch(() => null) : null;
        const f = (await drivePut(await lockPhoto(p, full, thumb), photoName(p.id))).file;
        if (f) { live.files.push(f); onDrive.set(f.name, f.id); }
      } catch (e) {
        if (/연결|로그인|서버 준비/.test(e.message || '')) throw e;
        live.photoFail.set(p.id, (live.photoFail.get(p.id) || 0) + 1);
      }
    }
    // 앱에서 지웠거나 원본이 드라이브로 옮겨진 사진의 백업 사본: 30일 뒤에 지워요
    if ((data.photos || []).length) {
      const have = new Set(photos.map((p) => photoName(p.id)));
      const gone = { ...(autoCfg().gone || {}) };
      for (const k of Object.keys(gone)) if (have.has(k) || !onDrive.has(k)) delete gone[k];
      for (const [name, id] of onDrive) {
        if (have.has(name)) continue;
        if (!gone[name]) gone[name] = now;
        else if (now - gone[name] > PHOTO_GRACE) {
          try { await driveDelete(id); live.files = live.files.filter((x) => x.id !== id); delete gone[name]; } catch (_) { /* 다음에 */ }
        }
      }
      patchAuto({ gone });
    }
    return todo.length > n;
  }
  const liveFiles = () => live.files;
  const setLiveFiles = (files) => { if (files) { live.files = files.slice(); live.filesUser = uid(); } };
  // 설정 화면에 보여줄 백업 목록: 실시간 최신본 먼저, 그다음 날짜 보관본 (사진 · 폴더는 숨겨요)
  const backupFiles = (files) => {
    const fs = files || [];
    const lv = fs.filter((f) => isLive(f.name));
    const rest = fs.filter((f) => isDaily(f.name)).sort((x, y) => String(y.createdTime).localeCompare(String(x.createdTime)));
    return [...lv.map((f) => ({ ...f, live: true, when: f.modifiedTime || f.createdTime })), ...rest.map((f) => ({ ...f, when: f.createdTime }))];
  };
  const photoCount = (files) => (files || []).filter((f) => isOrigFile(f.name)).length;
  // 예전 이름 (하루 한 번 자동 백업) — 이제는 실시간으로 해요
  const autoTick = async (getData, appVersion) => { liveSoon(getData, appVersion); return null; };

  return {
    snapshot, lock, unlock, peek, merge, counts, fileName, saveFile, pickFile,
    keyReady, keyExists, keyUnlock, keyOnLogin, keyOnPasswordChange, forgetKey,
    driveStatus, driveOn, driveList, driveUsage, driveAdminUsage, driveUpload, drivePut, driveDownload, driveDelete, driveDisconnect, driveConnect, driveFileToken,
    lockPhoto, unlockPhoto, photoName, restorePhotoFiles, isLive, isDaily, isPhotoFile, isOrigFile, LIVE_NAME,
    photoToDrive, drivePhotoPut, drivePhotoDelete, photoOriginalUrl, origCached, clearOriginals, photoMoveSetup, photoMoveTick, photoStats,
    autoCfg, setAuto, autoTick, liveSoon, liveRun, liveOnce, liveState, onLive, liveFiles, setLiveFiles, backupFiles, photoCount, KINDS,
  };
})();
if (typeof module !== 'undefined') module.exports = HaruBackup; // 시험용
