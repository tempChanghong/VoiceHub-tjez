self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // PWA 标准要求必须拦截 fetch 并提供响应
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // 当断网时，尝试返回一个基础响应防止白屏报错导致 PWA 卸载
        return new Response('Internet Disconnected.');
      })
    );
  }
});
