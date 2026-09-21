/* Lingo Scholar Service Worker
   策略：
   - 应用壳与静态资源：stale-while-revalidate，可离线打开。
   - 课程音频：不默认全部缓存；仅缓存用户实际播放过的音频（用户可选择离线内容）。
   - API：网络优先，绝不缓存 /api 响应，避免把某个账号的私有数据泄露给下一个登录者。
*/
const VERSION = 'lingo-cloud-v2';
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'clear-private') {
    // 退出登录时清理私有缓存，避免下一位登录者看到上一位的数据
    caches.delete(SHELL).then(() => caches.keys()).then((keys) => Promise.all(keys.filter((k) => k.startsWith(VERSION)).map((k) => caches.delete(k))));
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // API 一律走网络，不缓存
  if (url.pathname.startsWith('/api/')) return;
  // Private library content must always pass server authentication, including after logout.
  if (url.pathname.startsWith('/resources/') || url.pathname.startsWith('/media/')) return;

  // 音频：缓存优先（按需缓存），支持 Range
  if (url.pathname.startsWith('/media/')) {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(url.pathname);
      if (hit && !e.request.headers.has('range')) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok && res.status === 200 && !e.request.headers.has('range')) cache.put(url.pathname, res.clone());
        return res;
      } catch (err) {
        if (hit) return hit;
        return new Response(JSON.stringify({ error: 'OFFLINE_MEDIA_UNAVAILABLE' }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
    })());
    return;
  }

  // 应用壳
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        const cache = await caches.open(SHELL);
        cache.put('/index.html', res.clone());
        return res;
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('/index.html')) || new Response('离线且没有缓存', { status: 503 });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(e.request);
    const network = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || network;
  })());
});
