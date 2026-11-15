/* HaruPlanner 모바일 서비스 워커: 앱 화면 파일을 폰에 저장해 두고 빨리(오프라인에서도) 열어요.
 * 일정 데이터(Supabase)는 여기서 저장하지 않아요. 버전과 파일 목록은 빌드할 때 scripts/build-mobile.js 가 채워요. */
const CACHE = "haru-mobile-1.9.2-mwhwis6c";
const FILES = [
  "./",
  "404.html",
  "cloud.js",
  "config.js",
  "fonts/Dahyun.ttf",
  "fonts/Euiyeon.ttf",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "manifest.webmanifest",
  "mobile.css",
  "mobile.js",
  "shared.js",
  "vendor/supabase.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
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
  // 저장해 둔 걸 바로 보여주고, 뒤에서 새 버전을 받아 둬요 (다음에 열 때 반영)
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok && res.type === 'basic') c.put(key, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('오프라인이에요', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
