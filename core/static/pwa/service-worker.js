// Nome do cache (mude a versão quando fizer mudanças grandes no front)
const CACHE_NAME = "checkauto-pwa-v2026-01-09";

// Lista de arquivos essenciais para o app abrir (app shell)
const URLS_TO_CACHE = [
  "/pwa/offline/",
  "/static/pwa/manifest.json",
  "/static/pwa/js/app.js",
  "/static/pwa/js/api.js",
  "/static/pwa/js/db.js",
  "/static/pwa/js/sync.js",
  "/static/shared/api.js",
  "/static/pwa/icons/icon-192.png",
  "/static/pwa/icons/icon-512.png",
  "/static/pwa/icons/apple-touch-icon.png"
];

// Evento de instalação: cacheia os arquivos do app shell
self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        URLS_TO_CACHE.map(async url => {
          try {
            await cache.add(url);
          } catch (error) {
            console.warn("[SW] Falha ao cachear asset:", url, error);
          }
        })
      );
    })()
  );
});

// Evento de ativação: limpa caches antigos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Listener para permitir atualização do SW sem desinstalar o app
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Evento de fetch: responde com cache quando possível
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Ignora qualquer rota que não esteja dentro do escopo do PWA, evitando interferir no painel/admin
  const isPwaRoute =
    url.pathname.startsWith("/pwa/") ||
    url.pathname.startsWith("/static/pwa/") ||
    url.pathname.startsWith("/static/shared/");
  if (!isPwaRoute) {
    return;
  }

  // Para chamadas de navegação (HTML), tenta rede primeiro, fallback para cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cacheResp => cacheResp || caches.match("/pwa/offline/"))
        )
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/static/") || url.pathname.startsWith("/pwa/");

  if (isStaticAsset) {
    // Para assets estáticos (CSS, JS, ícones) do PWA: Cache First
    event.respondWith(
      caches.match(request).then(response => {
        return (
          response ||
          fetch(request).then(networkResponse => {
            if (networkResponse && networkResponse.ok) {
              return caches.open(CACHE_NAME).then(cache => {
                cache.put(request, networkResponse.clone());
                return networkResponse;
              });
            }
            return networkResponse;
          })
        );
      })
    );
  }
});
