'use strict';
// 일정 첨부파일 (PC · 폰 같이 써요)
//  - 파일은 사용자 구글 드라이브의 "앱 전용 숨김 폴더" 안 "HaruPlanner 첨부파일" 폴더에 그대로(암호화 없이) 들어가요
//    → 사용자의 드라이브 용량을 써요. 파일 하나 최대 5GB.
//  - 크기가 커서 서버를 거치지 않고 앱이 구글과 바로 주고받아요 (이어 올리기). 서버(gdrive 의 file-token)는
//    앱 전용 폴더만 쓸 수 있는 1시간짜리 열쇠만 줘요.
//  - 할 일에는 { id, name, size, type, drive(드라이브 파일 번호), at } 만 적어 둬요 (task.files)
//  - PC 는 큰 파일을 디스크에서 바로 읽고 쓰려고 메인 프로세스(attach-main.js)가 주고받고, 폰(웹)은 여기 fetch 로 해요
(function (root) {
  const MAX = 5 * 1024 * 1024 * 1024; // 파일 하나 5GB
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtSize(b) {
    b = Number(b) || 0;
    if (b < 1024) return `${b}B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
    return `${b >= 100 ? Math.round(b) : b >= 10 ? b.toFixed(1).replace(/\.0$/, '') : b.toFixed(2).replace(/\.?0+$/, '')}${u[i]}`;
  }
  // 아이콘 글자 · 색 고를 때 쓰는 종류
  function kindOf(name, type) {
    const ext = (/\.([a-z0-9]{1,6})$/i.exec(String(name || '')) || [])[1];
    const e = ext ? ext.toLowerCase() : '';
    const t = String(type || '');
    if (/^image\//.test(t) || /^(png|jpe?g|gif|webp|heic|heif|bmp|svg|avif)$/.test(e)) return { k: 'img', ext: e || 'img' };
    if (/^video\//.test(t) || /^(mp4|mov|avi|mkv|webm|m4v|wmv)$/.test(e)) return { k: 'video', ext: e || 'video' };
    if (/^audio\//.test(t) || /^(mp3|m4a|wav|flac|aac|ogg)$/.test(e)) return { k: 'audio', ext: e || 'audio' };
    if (e === 'pdf') return { k: 'pdf', ext: e };
    if (/^(zip|7z|rar|tar|gz|alz|egg)$/.test(e)) return { k: 'zip', ext: e };
    if (/^(xlsx?|csv|cell|numbers)$/.test(e)) return { k: 'sheet', ext: e };
    if (/^(pptx?|show|key)$/.test(e)) return { k: 'slide', ext: e };
    if (/^(docx?|hwpx?|txt|md|rtf|pages)$/.test(e)) return { k: 'doc', ext: e };
    return { k: 'file', ext: e || 'file' };
  }
  const driveName = (id, name) => `att-${id}-${String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150)}`;
  const files = (t) => (t && Array.isArray(t.files) ? t.files.filter((a) => a && a.id) : []);

  function tokenErr(resumeUrl, sent) { const e = new Error('드라이브 열쇠가 만료됐어요'); e.code = 'token'; e.resumeUrl = resumeUrl || ''; e.sent = sent || 0; return e; }
  async function gErr(r) {
    let m = '';
    try { const j = await r.json(); m = (j.error && (j.error.message || j.error)) || ''; } catch (_) { /* 무시 */ }
    if (r.status === 403 && /quota|storage/i.test(String(m))) return '구글 드라이브 공간이 모자라요';
    return `드라이브 오류 (${r.status}${m ? `: ${String(m).slice(0, 120)}` : ''})`;
  }
  const rangeEnd = (r) => { const m = /bytes=0-(\d+)/.exec(r.headers.get('range') || ''); return m ? Number(m[1]) + 1 : null; };
  const fileOf = (d, total) => ({ id: d.id, size: Number(d.size) || total });

  // 지금까지 몇 바이트 올라갔는지 물어봐요
  async function sentSoFar(url, total, token, signal) {
    const r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${total}` }, signal });
    if (r.status === 200 || r.status === 201) return { done: fileOf(await r.json().catch(() => ({})), total) };
    if (r.status === 401) throw tokenErr(url, 0);
    if (r.status === 404 || r.status === 410) return { gone: true };
    if (r.status !== 308) throw new Error(await gErr(r));
    return { sent: rangeEnd(r) || 0 };
  }

  // 이어 올리기 (구글 드라이브 resumable upload)
  //  o: { token, folder, name(드라이브에 둘 이름), mime, size, read(start, end) → Blob|Buffer, chunk, onProgress(sent, total, url), signal, resumeUrl }
  //  열쇠가 만료되면 code:'token' 오류에 resumeUrl 을 붙여서 던져요 → 새 열쇠로 다시 부르면 이어서 올려요
  async function upload(o) {
    const total = Number(o.size) || 0;
    const chunk = o.chunk || 8 * 1024 * 1024;
    let url = o.resumeUrl || '';
    let sent = 0;
    if (url) {
      const s = await sentSoFar(url, total, o.token, o.signal);
      if (s.done) return s.done;
      if (s.gone) url = ''; else sent = s.sent;
    }
    if (!url) {
      const r = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': o.mime || 'application/octet-stream', 'X-Upload-Content-Length': String(total) },
        body: JSON.stringify({ name: o.name, parents: [o.folder] }),
        signal: o.signal,
      });
      if (r.status === 401) throw tokenErr('', 0);
      if (!r.ok) throw new Error(await gErr(r));
      url = r.headers.get('location') || '';
      if (!url) throw new Error('드라이브가 올릴 주소를 주지 않았어요');
      sent = 0;
    }
    if (o.onProgress) o.onProgress(sent, total, url);
    let fails = 0;
    for (;;) {
      const end = Math.min(total, sent + chunk);
      let r = null;
      try {
        const body = total ? await o.read(sent, end) : '';
        r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${o.token}`, 'Content-Range': total ? `bytes ${sent}-${end - 1}/${total}` : 'bytes */0' }, body, signal: o.signal });
      } catch (e) {
        if (o.signal && o.signal.aborted) throw e;
        r = null; // 인터넷이 잠깐 끊겼어요 → 아래에서 쉬었다 이어서
      }
      if (r && (r.status === 200 || r.status === 201)) return fileOf(await r.json().catch(() => ({})), total);
      if (r && r.status === 308) {
        sent = rangeEnd(r) ?? end;
        fails = 0;
        if (o.onProgress) o.onProgress(sent, total, url);
        continue;
      }
      if (r && r.status === 401) throw tokenErr(url, sent);
      if (r && (r.status === 404 || r.status === 410)) throw new Error('올리기가 끊겼어요. 다시 넣어 주세요');
      if (r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new Error(await gErr(r));
      if (++fails > 8) throw new Error('인터넷이 불안정해서 올리지 못했어요');
      await sleep(Math.min(30000, 1000 * 2 ** (fails - 1)));
      try {
        const s = await sentSoFar(url, total, o.token, o.signal);
        if (s.done) return s.done;
        if (s.gone) throw new Error('올리기가 끊겼어요. 다시 넣어 주세요');
        sent = s.sent;
      } catch (e) {
        if (e && e.code === 'token') throw tokenErr(url, sent);
        if (o.signal && o.signal.aborted) throw e;
        if (/끊겼어요/.test(e.message || '')) throw e;
      }
    }
  }

  // 받기 (웹): Blob 으로
  async function downloadBlob(o) {
    const r = await fetch(`${DRIVE}/files/${encodeURIComponent(o.id)}?alt=media`, { headers: { Authorization: `Bearer ${o.token}` }, signal: o.signal });
    if (r.status === 401) throw tokenErr('', 0);
    if (r.status === 404) throw new Error('드라이브에 이 파일이 없어요');
    if (!r.ok) throw new Error(await gErr(r));
    const total = Number(r.headers.get('content-length')) || Number(o.size) || 0;
    if (!r.body || !r.body.getReader) return r.blob();
    const rd = r.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (o.onProgress) o.onProgress(got, total);
    }
    return new Blob(parts, { type: o.type || 'application/octet-stream' });
  }
  async function removeFile(token, id) {
    const r = await fetch(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) throw tokenErr('', 0);
    if (!r.ok && r.status !== 404) throw new Error(await gErr(r));
  }

  // 웹(폰)에서 쓰는 주고받기 방법
  const webTransport = {
    upload: (job, t, resumeUrl, onProgress) => {
      job.ctl = new AbortController();
      return upload({ token: t.token, folder: t.folder, name: driveName(job.id, job.name), mime: job.type, size: job.size, read: (s, e) => job.src.file.slice(s, e), chunk: 4 * 1024 * 1024, onProgress, signal: job.ctl.signal, resumeUrl });
    },
    cancel: (job) => { if (job.ctl) job.ctl.abort(); },
    remove: (t, id) => removeFile(t.token, id),
    download: (att, t, onProgress, signal) => downloadBlob({ token: t.token, id: att.drive, size: att.size, type: att.type, onProgress, signal }),
  };

  // ---------- 화면에서 쓰는 관리자 ----------
  //  opt: { transport, newId(), findTask(id), data(), userId(), saved(task, att), changed(), toast(msg) }
  function manager(opt) {
    const tr = opt.transport || webTransport;
    const jobs = new Map(); // 올리는 중인 파일 (끝나면 할 일에 붙여요)
    let tk = null;
    async function token(force, quota) {
      if (!force && !quota && tk && tk.exp > Date.now() + 60000) return tk;
      if (typeof HaruBackup === 'undefined') throw new Error('로그인이 필요해요');
      const r = await HaruBackup.driveFileToken(quota);
      if (!r || !r.token) throw new Error('드라이브 열쇠를 받지 못했어요');
      tk = { token: r.token, exp: Number(r.exp) || Date.now() + 30 * 60000, folder: r.folder };
      return { ...tk, free: r.free == null ? null : Number(r.free) };
    }
    // 열쇠가 만료됐으면 새로 받아서 한 번 더
    async function withToken(fn) {
      try { return await fn(await token(false)); } catch (e) {
        if (e && e.code === 'token') return fn(await token(true));
        throw e;
      }
    }

    let tickT = 0;
    function tick(now) {
      if (now) { clearTimeout(tickT); tickT = 0; opt.changed(); return; }
      if (!tickT) tickT = setTimeout(() => { tickT = 0; opt.changed(); }, 120);
    }
    async function runJob(j) {
      let resume = '';
      for (let tries = 0; ; tries++) {
        const t = await token(tries > 0);
        try {
          return await tr.upload(j, t, resume, (sent, _total, url) => { j.sent = sent; if (url) j.url = url; tick(); });
        } catch (e) {
          if (e && e.code === 'token' && tries < 4) { resume = e.resumeUrl || j.url || ''; continue; }
          throw e;
        }
      }
    }
    let running = 0;
    function pump() {
      while (running < 2) {
        const j = [...jobs.values()].find((x) => x.state === 'wait');
        if (!j) return;
        running++;
        j.state = 'up';
        runJob(j).then((f) => {
          jobs.delete(j.id);
          const task = opt.findTask(j.taskId);
          if (!task) { withToken((t) => tr.remove(t, f.id)).catch(() => {}); return; } // 그사이 할 일이 지워졌어요
          const att = { id: j.id, name: j.name, size: Number(f.size) || j.size, type: j.type || '', drive: f.id, at: Date.now() };
          task.files = [...files(task), att];
          opt.saved(task, att);
        }).catch((e) => {
          if (j.state === 'cancel') { jobs.delete(j.id); return; }
          j.state = 'err';
          j.err = (e && e.message) || String(e);
          opt.toast(`"${j.name}" 올리지 못했어요 · ${j.err}`);
        }).finally(() => { running--; tick(true); pump(); });
      }
    }

    // items: [{ name, size, type, file(웹) | path(PC) }]
    async function add(taskId, items) {
      items = (items || []).filter((f) => f && f.name);
      const big = items.filter((f) => Number(f.size) > MAX);
      if (big.length) opt.toast(`파일 하나는 5GB까지 넣을 수 있어요 · "${big[0].name}" ${fmtSize(big[0].size)}`);
      items = items.filter((f) => Number(f.size) <= MAX);
      if (!items.length) return 0;
      let t;
      try { t = await token(true, true); } catch (e) { opt.toast(e.message || String(e)); return 0; }
      const busy = [...jobs.values()].filter((j) => j.state === 'up' || j.state === 'wait').reduce((s, j) => s + (j.size - (j.sent || 0)), 0);
      const need = items.reduce((s, f) => s + Number(f.size), 0) + busy;
      if (t.free != null && need > t.free) { opt.toast(`구글 드라이브 공간이 모자라요 · 남은 공간 ${fmtSize(t.free)}`); return 0; }
      for (const f of items) {
        const id = opt.newId();
        jobs.set(id, { id, taskId, name: f.name, size: Number(f.size) || 0, type: f.type || '', src: f, sent: 0, state: 'wait' });
      }
      tick(true);
      pump();
      return items.length;
    }
    function cancel(jobId) {
      const j = jobs.get(jobId);
      if (!j) return;
      if (j.state === 'up') { j.state = 'cancel'; try { tr.cancel(j); } catch (_) { /* 무시 */ } } else jobs.delete(jobId);
      tick(true);
    }
    function retry(jobId) {
      const j = jobs.get(jobId);
      if (!j || j.state !== 'err') return;
      Object.assign(j, { state: 'wait', sent: 0, err: '', url: '' });
      tick(true);
      pump();
    }
    const pending = (taskId) => [...jobs.values()].filter((j) => j.taskId === taskId && j.state !== 'cancel');
    const busy = () => [...jobs.values()].some((j) => j.state === 'up' || j.state === 'wait');

    // ---------- 뺀 첨부파일은 드라이브에서도 지워요 ----------
    // 이 기기에서 저장할 때마다 붙어 있는 파일 목록을 비교해서, 빠진 파일은 20초 뒤(실행 취소할 틈) 아무 할 일에도
    // 없으면 지워요. 다른 기기에서 온 변경이나 데이터가 통째로 바뀐 경우(로그아웃 · 복원)는 지우지 않아요.
    let base = null;
    const refIds = (data) => {
      const s = new Set();
      for (const t of (data && data.tasks) || []) for (const a of files(t)) if (a.drive) s.add(a.drive);
      return s;
    };
    function rebase() { const d = opt.data(); base = { ref: d, uid: opt.userId(), ids: refIds(d) }; }
    function watch() {
      const d = opt.data();
      const u = opt.userId();
      const ids = refIds(d);
      if (!base || base.ref !== d || base.uid !== u) { base = { ref: d, uid: u, ids }; return; }
      const gone = [...base.ids].filter((id) => !ids.has(id));
      base.ids = ids;
      if (!gone.length || gone.length > 50 || !u) return;
      setTimeout(() => sweep(gone, d, u), 20000);
    }
    async function sweep(ids, d, u) {
      if (opt.data() !== d || opt.userId() !== u) return;
      const still = refIds(d);
      for (const id of ids) {
        if (still.has(id)) continue;
        try { await withToken((t) => tr.remove(t, id)); } catch (_) { /* 다음에 못 지워도 할 일에는 영향 없어요 */ }
      }
    }

    // 받기 (웹: Blob · PC: transport 가 디스크로)
    const loading = new Map(); // drive id → { got, total }
    async function download(att, mode) {
      if (loading.has(att.drive)) return null;
      loading.set(att.drive, { got: 0, total: att.size });
      tick(true);
      try {
        return await withToken((t) => tr.download(att, t, (got, total) => { loading.set(att.drive, { got, total: total || att.size }); tick(); }, null, mode));
      } finally { loading.delete(att.drive); tick(true); }
    }
    const progressOf = (driveId) => loading.get(driveId) || null;

    return { add, cancel, retry, pending, busy, watch, rebase, download, progressOf, token, withToken, jobs };
  }

  const api = { MAX, fmtSize, kindOf, driveName, files, upload, downloadBlob, removeFile, manager, webTransport };
  root.HaruAttach = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
