'use strict';

/* =========================================================================
 * 내 데이터 백업 (데스크톱 · 폰 같이 써요)
 *  - 할 일 · 목록 · 디데이 · 포스트잇 · 사진 목록 · 타이머 기록 · 설정을 파일 하나로
 *  - 내가 정한 비밀번호로 암호화해요 (AES-256-GCM, 비밀번호 → PBKDF2-SHA256 31만 번)
 *    → 비밀번호 없이는 아무도(구글 · Supabase · 개발자 포함) 열 수 없어요. 비밀번호를 잊으면 복구할 수 없어요.
 *  - 저장 위치: ① 이 기기에 파일로  ② 구글 드라이브의 "앱 전용 숨김 폴더" (드라이브 화면에 안 보여요)
 *  - 되살리기는 "합치기": 지금 없는 항목만 다시 넣어요 (지금 있는 건 바꾸거나 지우지 않아요)
 *  - 사진 파일 자체는 Supabase 저장소에 그대로 있고, 백업에는 사진 목록(어느 날 어떤 사진)이 들어가요
 * ========================================================================= */

const HaruBackup = (() => {
  const MAGIC = 'HaruPlanner-backup';
  const ITER = 310000;
  const KINDS = ['lists', 'tasks', 'ddays', 'sessions', 'notes', 'photos'];
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  async function keyFrom(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // 지금 데이터 → 백업 내용 (평문)
  function snapshot(data, appVersion) {
    const d = {};
    for (const k of KINDS) d[k] = JSON.parse(JSON.stringify(data[k] || []));
    d.settings = JSON.parse(JSON.stringify(data.settings || {}));
    return { app: MAGIC, v: 1, at: Date.now(), version: appVersion || '', data: d };
  }
  const counts = (d) => Object.fromEntries(KINDS.map((k) => [k, (d[k] || []).length]));

  // 암호화 → 문자열(JSON). 파일 · 드라이브에 그대로 저장해요
  async function lock(snap, password) {
    if (!password || String(password).length < 4) throw new Error('비밀번호는 4자 이상이어야 해요');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(password, salt, ITER);
    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(snap)));
    // 겉에는 언제 만든 백업인지 · 몇 개인지만 (내용은 전부 암호문)
    return JSON.stringify({ app: MAGIC, v: 1, at: snap.at, version: snap.version, counts: counts(snap.data), kdf: { name: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt) }, cipher: { name: 'AES-256-GCM', iv: b64(iv) }, data: b64(body) });
  }
  function peek(text) {
    let o;
    try { o = JSON.parse(text); } catch (_) { throw new Error('하루플래너 백업 파일이 아니에요'); }
    if (!o || o.app !== MAGIC || !o.data || !o.kdf || !o.cipher) throw new Error('하루플래너 백업 파일이 아니에요');
    return o;
  }
  async function unlock(text, password) {
    const o = peek(text);
    const key = await keyFrom(password, unb64(o.kdf.salt), Number(o.kdf.iter) || ITER);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.cipher.iv) }, key, unb64(o.data)); } catch (_) { throw new Error('비밀번호가 맞지 않아요'); }
    const snap = JSON.parse(dec.decode(plain));
    if (!snap || snap.app !== MAGIC || !snap.data) throw new Error('백업 내용이 올바르지 않아요');
    return snap;
  }

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
      try { const j = await error.context.json(); msg = j.error || msg; } catch (_) { /* 무시 */ }
      if (/not found|404|Failed to send/i.test(msg)) msg = '서버 준비가 아직 안 됐어요 (deploy-gcal)';
      throw new Error(msg);
    }
    return data;
  }
  const driveStatus = () => drive('status');
  const driveList = () => drive('list');
  const driveUpload = (text, name) => drive('upload', { name: name || fileName(), content: text });
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

  // ---------- 자동 백업 (하루 한 번, 이 기기에서 켠 경우만) ----------
  // 자동으로 하려면 비밀번호를 이 기기에 기억해야 해요 (다른 기기 · 서버로는 안 보내요)
  const AUTO_KEY = 'haru-backup-auto';
  const autoCfg = () => { try { return JSON.parse(localStorage.getItem(AUTO_KEY)) || {}; } catch (_) { return {}; } };
  const setAuto = (o) => { try { if (o) localStorage.setItem(AUTO_KEY, JSON.stringify(o)); else localStorage.removeItem(AUTO_KEY); } catch (_) { /* 무시 */ } };
  async function autoTick(getData, appVersion) {
    const a = autoCfg();
    if (!a.on || !a.pw) return null;
    if (a.last && Date.now() - a.last < 22 * 3600 * 1000) return null; // 하루에 한 번
    const data = getData();
    if (!data || !(data.tasks || []).length) return null;
    const text = await lock(snapshot(data, appVersion), a.pw);
    await driveUpload(text);
    // 오래된 자동 백업은 최근 14개만 남겨요
    try {
      const { files = [] } = await driveList();
      for (const f of files.slice(14)) await driveDelete(f.id);
    } catch (_) { /* 정리는 다음에 */ }
    setAuto({ ...a, last: Date.now() });
    return true;
  }

  return { snapshot, lock, unlock, peek, merge, counts, fileName, saveFile, pickFile, driveStatus, driveList, driveUpload, driveDownload, driveDelete, driveDisconnect, driveConnect, autoCfg, setAuto, autoTick, KINDS };
})();
if (typeof module !== 'undefined') module.exports = HaruBackup; // 시험용
