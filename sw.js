/* HaruPlanner 모바일 서비스 워커: 앱 화면 파일을 폰에 저장해 두고 빨리(오프라인에서도) 열어요.
 * 일정 데이터(Supabase)는 여기서 저장하지 않아요. 버전과 파일 목록은 빌드할 때 scripts/build-mobile.js 가 채워요. */
const CACHE = "haru-mobile-1.21.0-mwm6ilha";
const FILES = [
  "./",
  "backup.js",
  "calsync.js",
  "changelog.js",
  "cloud.js",
  "config.js",
  "connected.html",
  "devcal.js",
  "devmode.js",
  "fonts/Dahyun.ttf",
  "fonts/Euiyeon.ttf",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "manifest.webmanifest",
  "mobile.css",
  "mobile.js",
  "photos.js",
  "privacy.html",
  "shared.js",
  "vendor/supabase.js"
];

// 설치할 때는 브라우저 캐시(GitHub Pages 10분)를 건너뛰고 서버에서 직접 받아요
// → 새 버전 꼬리표에 예전 파일이 섞여 저장되는 일이 없어요
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('haru-mobile-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase 등은 그대로 인터넷으로
  // 이 버전에 저장해 둔 파일은 그대로 써요 (한 버전의 파일끼리만 짝이 맞게).
  // 새 버전은 sw.js 가 바뀌면 통째로 새로 받아요. 저장해 둔 게 없는 파일만 인터넷에서 받아요.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await c.match(key, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req).catch(() => null);
    if (res && res.ok && res.type === 'basic' && req.mode !== 'navigate') c.put(key, res.clone());
    return res || new Response('오프라인이에요', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
