// Service Worker do Casa em Ordem
// - Arquivos do app: rede primeiro, cache como reserva (funciona offline com a última versão baixada)
// - Bibliotecas do CDN (versões fixas): cache primeiro
// - Chamadas ao Supabase: nunca passam pelo cache (dados sempre ao vivo)

const VERSAO_CACHE = 'casa-em-ordem-v3';

const ARQUIVOS_APP = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
];

const CDN_LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.6.2/dist/chart.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSAO_CACHE).then((cache) => cache.addAll([...ARQUIVOS_APP, ...CDN_LIBS]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== VERSAO_CACHE).map((c) => caches.delete(c)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase (API, Auth, Realtime): sempre direto na rede
  if (url.hostname.endsWith('.supabase.co')) return;

  // Bibliotecas com versão fixa: cache primeiro
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(request).then((emCache) => emCache || fetch(request).then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO_CACHE).then((cache) => cache.put(request, copia));
        return resp;
      }))
    );
    return;
  }

  // Arquivos do próprio app: rede primeiro, cache como reserva
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(VERSAO_CACHE).then((cache) => cache.put(request, copia));
          return resp;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
  }
});

// Ao tocar numa notificação, abre (ou traz para frente) o app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((j) => j.url.startsWith(self.registration.scope));
      if (aberta) return aberta.focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
