'use strict';

/* =========================================================================
 * 내 데이터 백업 (데스크톱 · 폰 같이 써요)
 *  - 할 일 · 목록 · 디데이 · 포스트잇 · 사진 목록 · 타이머 기록 · 설정을 파일 하나로
 *  - 내가 정한 비밀번호로 암호화해요 (AES-256-GCM, 비밀번호 → PBKDF2-SHA256 31만 번)
 *    → 비밀번호 없이는 아무도(구글 · Supabase · 개발자 포함) 열 수 없어요. 비밀번호를 잊으면 복구할 수 없어요.
 *  - 저장 위치: ① 이 기기에 파일로  ② 구글 드라이브의 "앱 전용 숨김 폴더" (드라이브 화면에 안 보여요)
 *  - 되살리기는 "합치기": 지금 없는 항목만 다시 넣어요 (지금 있는 건 바꾸거나 지우지 않아요)
 *  - 실시간 드라이브 백업(켠 기기에서): 무엇이든 바뀌면 몇 초 뒤 드라이브의
 *      HaruPlanner-live.haru (최신 1개, 덮어쓰기) + 하루 한 번 날짜 붙은 보관본(최근 14개)
 *      + 사진 파일 하나하나 photo-<id>.haru (사진도 같은 비밀번호로 암호화)
 * ========================================================================= */

const HaruBackup = (() => {
  const MAGIC = 'HaruPlanner-backup';
  const ITER = 310000;
  const KINDS = ['lists', 'tasks', 'ddays', 'sessions', 'notes', 'photos'];
  const LIVE_NAME = 'HaruPlanner-live.haru';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const randB64 = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));

  // 비밀번호 → 열쇠 (31만 번 계산이라 같은 비밀번호 · 소금이면 한 번만 만들어 둬요)
  const keys = new Map();
  function keyFor(password, saltB64, iter) {
    const k = `${iter}|${saltB64}|${password}`;
    if (!keys.has(k)) {
      const p = crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey'])
        .then((base) => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
      p.catch(() => keys.delete(k));
      if (keys.size > 20) keys.clear();
      keys.set(k, p);
    }
    return keys.get(k);
  }

  // 지금 데이터 → 백업 내용 (평문)
  function snapshot(data, appVersion) {
    const d = {};
    for (const k of KINDS) d[k] = JSON.parse(JSON.stringify(data[k] || []));
    d.settings = JSON.parse(JSON.stringify(data.settings || {}));
    return { app: MAGIC, v: 1, at: Date.now(), version: appVersion || '', data: d };
  }
  const counts = (d) => Object.fromEntries(KINDS.map((k) => [k, (d[k] || []).length]));

  // 바이트 → 암호문 JSON (겉에는 head 만 보여요)
  async function sealBytes(bytes, password, head, saltB64) {
    if (!password || String(password).length < 4) throw new Error('비밀번호는 4자 이상이어야 해요');
    const salt = saltB64 || randB64(16);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(password, salt, ITER);
    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return JSON.stringify({ app: MAGIC, v: 1, ...head, kdf: { name: 'PBKDF2-SHA256', iter: ITER, salt }, cipher: { name: 'AES-256-GCM', iv: b64(iv) }, data: b64(body) });
  }
  async function openBytes(o, password) {
    const key = await keyFor(password, o.kdf.salt, Number(o.kdf.iter) || ITER);
    try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.cipher.iv) }, key, unb64(o.data))); } catch (_) { throw new Error('비밀번호가 맞지 않아요'); }
  }

  // 암호화 → 문자열(JSON). 파일 · 드라이브에 그대로 저장해요
  // 겉에는 언제 만든 백업인지 · 몇 개인지만 (내용은 전부 암호문)
  const lock = (snap, password, saltB64) => sealBytes(enc.encode(JSON.stringify(snap)), password, { at: snap.at, version: snap.version, counts: counts(snap.data) }, saltB64);
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
  async function lockPhoto(photo, full, thumb, password, saltB64) {
    const meta = enc.encode(JSON.stringify({ id: photo.id, date: photo.date, path: photo.path, thumb: photo.thumb || '' }));
    const t = thumb || new Uint8Array(0);
    const buf = new Uint8Array(8 + meta.length + full.length + t.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, meta.length);
    buf.set(meta, 4);
    dv.setUint32(4 + meta.length, full.length);
    buf.set(full, 8 + meta.length);
    buf.set(t, 8 + meta.length + full.length);
    return sealBytes(buf, password, { kind: 'photo', at: Date.now() }, saltB64);
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
  const uid = () => { const u = typeof Cloud !== 'undefined' && Cloud.user && Cloud.user(); return (u && u.id) || ''; };
  async function drive(action, extra = {}) {
    const c = cli();
    if (!c) throw new Error('로그인이 필요해요');
    const { data, error } = await c.functions.invoke('gdrive', { body: { action, ...extra } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; } catch (_) { /* 무시 */ }
      if (/not found|404|Failed to send/i.test(msg)) msg = '서버 준비가 아직 안 됐어요 (deploy-gcal)';
      throw new Error(msg);
    }
    return data;
  }
  const driveStatus = () => drive('status');
  const driveList = () => drive('list');
  const driveUpload = (text, name) => drive('upload', { name: name || fileName(), content: text });
  const drivePut = (text, name) => drive('put', { name, content: text });
  const driveDownload = (id) => drive('download', { id }).then((r) => r.content);
  const driveDelete = (id) => drive('delete', { id });
  const driveDisconnect = () => drive('disconnect');
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

  // ---------- 사진 파일 (Supabase 저장소 ↔ 드라이브) ----------
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
  // 되살린 사진 목록의 실제 사진 파일을 드라이브에서 받아 저장소에 다시 넣어요
  async function restorePhotoFiles(photos, passwords, onStep) {
    const res = { ok: 0, missing: 0, badPw: 0 };
    if (!photos || !photos.length) return res;
    const { files = [] } = await driveList();
    const byName = new Map(files.filter((f) => isPhotoFile(f.name)).map((f) => [f.name, f.id]));
    const pws = [...new Set(passwords.filter(Boolean))];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (onStep) onStep(i + 1, photos.length);
      const id = byName.get(photoName(p.id));
      if (!id) { res.missing++; continue; }
      let got = null;
      try {
        const text = await driveDownload(id);
        for (const pw of pws) { try { got = await unlockPhoto(text, pw); break; } catch (_) { /* 다음 비밀번호 */ } }
      } catch (_) { res.missing++; continue; }
      if (!got) { res.badPw++; continue; }
      await storagePut(p.path, got.full);
      if (p.thumb && got.thumb) await storagePut(p.thumb, got.thumb);
      res.ok++;
    }
    return res;
  }

  // ---------- 실시간 자동 백업 (이 기기에서 켠 경우만) ----------
  // 자동으로 하려면 비밀번호를 이 기기에 기억해야 해요 (다른 기기 · 서버로는 안 보내요)
  // 설정: { on, pw, salt, hash, counts, liveAt, last(하루 보관본), gone{사진이름: 처음 없어진 때} }
  const AUTO_KEY = 'haru-backup-auto';
  const IDLE = 4000; // 마지막으로 바뀌고 4초 뒤
  const MAX_WAIT = 20000; // 계속 바뀌어도 20초마다는 올려요
  const DAY_KEEP = 14;
  const PHOTO_GRACE = 30 * 24 * 3600 * 1000; // 앱에서 지운 사진은 30일 뒤에 드라이브에서도 지워요
  const autoCfg = () => { try { return JSON.parse(localStorage.getItem(AUTO_KEY)) || {}; } catch (_) { return {}; } };
  const setAuto = (o) => { try { if (o) localStorage.setItem(AUTO_KEY, JSON.stringify(o)); else localStorage.removeItem(AUTO_KEY); } catch (_) { /* 무시 */ } live.files = null; notify(); };
  const patchAuto = (o) => { const a = autoCfg(); if (a.on) { try { localStorage.setItem(AUTO_KEY, JSON.stringify({ ...a, ...o })); } catch (_) { /* 무시 */ } } };
  const live = { timer: 0, first: 0, running: false, again: false, getData: null, ver: '', files: null, filesUser: '', err: '', busy: '', listeners: new Set(), retry: 0, photoFail: new Map() };
  const notify = () => live.listeners.forEach((f) => { try { f(); } catch (_) { /* 무시 */ } });
  const onLive = (f) => { live.listeners.add(f); return () => live.listeners.delete(f); };
  const liveState = () => ({ busy: live.busy, err: live.err, running: live.running });

  async function sha(text) { return b64(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

  // 데이터가 바뀔 때마다 불러 주세요 (앱 · 다른 기기에서 온 변경 모두). 잠깐 모았다가 한 번에 올려요
  function liveSoon(getData, appVersion) {
    if (getData) live.getData = getData;
    if (appVersion !== undefined) live.ver = appVersion;
    const a = autoCfg();
    if (!a.on || !a.pw) return;
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
      // 연결이 끊겼거나 서버가 없으면 기다려요. 인터넷 문제면 잠시 뒤 다시
      if (!/연결|로그인|서버 준비/.test(live.err)) { live.retry = Math.min(6, live.retry + 1); setTimeout(() => liveSoon(), 30000 * live.retry); }
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
    if (!a.on || !a.pw || !cli()) return false;
    const data = live.getData && live.getData();
    if (!data) return false;
    const c = counts(data);
    const total = Object.values(c).reduce((x, y) => x + y, 0);
    if (!total) return false; // 빈 데이터(불러오는 중 등)로 백업을 덮지 않아요
    if (!a.salt) { a.salt = randB64(16); patchAuto({ salt: a.salt }); }
    const me = uid();
    if (!live.files || live.filesUser !== me) { live.files = (await driveList()).files || []; live.filesUser = me; }
    const now = Date.now();

    // 1) 데이터: 바뀌었을 때만 HaruPlanner-live.haru 를 덮어써요
    const snap = snapshot(data, live.ver);
    const hash = await sha(`${me}|${a.salt}|${JSON.stringify(snap.data)}`);
    let text = null;
    if (hash !== a.hash) {
      live.busy = '드라이브에 올리는 중…';
      notify();
      text = await lock(snap, a.pw, a.salt);
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
      const f = (await driveUpload(text || await lock(snap, a.pw, a.salt), fileName(now))).file;
      if (f) live.files.push(f);
      patchAuto({ last: now });
      const daily = live.files.filter((x) => isDaily(x.name)).sort((x, y) => String(y.createdTime).localeCompare(String(x.createdTime)));
      for (const old of daily.slice(DAY_KEEP)) { try { await driveDelete(old.id); live.files = live.files.filter((x) => x.id !== old.id); } catch (_) { /* 다음에 */ } }
    }

    // 3) 사진 파일: 드라이브에 아직 없는 사진을 올려요 (한 번에 10장씩)
    const onDrive = new Map(live.files.filter((x) => isPhotoFile(x.name)).map((x) => [x.name, x.id]));
    const photos = (data.photos || []).filter((p) => p && p.id && p.path);
    const todo = photos.filter((p) => !onDrive.has(photoName(p.id)) && (live.photoFail.get(p.id) || 0) < 3);
    let n = 0;
    for (const p of todo.slice(0, 10)) {
      live.busy = `사진 올리는 중… (${++n}/${todo.length})`;
      notify();
      try {
        const full = await storageGet(p.path);
        const thumb = p.thumb ? await storageGet(p.thumb).catch(() => null) : null;
        const f = (await drivePut(await lockPhoto(p, full, thumb, a.pw, a.salt), photoName(p.id))).file;
        if (f) { live.files.push(f); onDrive.set(f.name, f.id); }
      } catch (e) {
        if (/연결|로그인|서버 준비/.test(e.message || '')) throw e;
        live.photoFail.set(p.id, (live.photoFail.get(p.id) || 0) + 1); // 저장소에 없는 사진 등은 몇 번 해 보고 넘어가요
      }
    }
    // 앱에서 지운 사진: 30일 동안은 드라이브에 남겨 두고(실수 대비), 그 뒤에 지워요
    if (photos.length) {
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
    if (n) patchAuto({ photoAt: Date.now() });
    return todo.length > n;
  }
  // 켜기 전에: 다른 기기에서 이미 실시간 백업을 쓰고 있으면 같은 비밀번호인지 확인해요
  async function checkLivePw(pw) {
    const { files = [] } = await driveList();
    const f = files.find((x) => isLive(x.name));
    if (!f) return true;
    try { await unlock(await driveDownload(f.id), pw); return true; } catch (e) {
      if (/비밀번호/.test(e.message)) throw new Error('다른 기기에서 정한 실시간 백업 비밀번호와 달라요. 같은 비밀번호를 넣어 주세요.');
      return true;
    }
  }
  const livePhotoCount = () => (live.files || []).filter((x) => isPhotoFile(x.name)).length;
  const liveFiles = () => live.files;
  const setLiveFiles = (files) => { if (files) { live.files = files.slice(); live.filesUser = uid(); } };
  // 설정 화면에 보여줄 백업 목록: 실시간 최신본 먼저, 그다음 날짜 보관본 (사진 파일은 숨겨요)
  const backupFiles = (files) => {
    const fs = files || [];
    const lv = fs.filter((f) => isLive(f.name));
    const rest = fs.filter((f) => !isLive(f.name) && !isPhotoFile(f.name)).sort((x, y) => String(y.createdTime).localeCompare(String(x.createdTime)));
    return [...lv.map((f) => ({ ...f, live: true, when: f.modifiedTime || f.createdTime })), ...rest.map((f) => ({ ...f, when: f.createdTime }))];
  };
  const photoCount = (files) => (files || []).filter((f) => isPhotoFile(f.name)).length;
  // 예전 이름 (하루 한 번 자동 백업) — 이제는 실시간으로 해요
  const autoTick = async (getData, appVersion) => { liveSoon(getData, appVersion); return null; };

  return {
    snapshot, lock, unlock, peek, merge, counts, fileName, saveFile, pickFile,
    driveStatus, driveList, driveUpload, drivePut, driveDownload, driveDelete, driveDisconnect, driveConnect,
    lockPhoto, unlockPhoto, photoName, restorePhotoFiles, isLive, isDaily, isPhotoFile, LIVE_NAME,
    autoCfg, setAuto, autoTick, liveSoon, liveRun, liveOnce, liveState, onLive, checkLivePw, livePhotoCount, liveFiles, setLiveFiles, backupFiles, photoCount, KINDS,
  };
})();
if (typeof module !== 'undefined') module.exports = HaruBackup; // 시험용
