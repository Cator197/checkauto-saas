// Nome do cache (mude a versão quando fizer mudanças grandes no front)
const CACHE_NAME = "checkauto-pwa-v3";

// Lista de arquivos essenciais para o app abrir (app shell)
const URLS_TO_CACHE = [
  "/pwa/",                 // home do PWA
  "/static/pwa/js/app.js", // script principal
  "/static/pwa/icons/icon-192.png",
  "/static/pwa/icons/icon-512.png",
  "/static/css/base.css"   // ajuste para o seu CSS real (ou remova se não tiver ainda)
];

// Evento de instalação: cacheia os arquivos do app shell
self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .then(() => self.skipWaiting())
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

// Evento de fetch: responde com cache quando possível
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  // Ignora qualquer rota que não esteja dentro do escopo do PWA, evitando interferir no painel/admin
  const isPwaRoute = url.pathname.startsWith("/pwa") || url.pathname.startsWith("/static/pwa/");
  if (!isPwaRoute) {
    return;
  }

  // Para chamadas de navegação (HTML), tenta rede primeiro, fallback para cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/pwa/"))
    );
    return;
  }

  // Para assets estáticos (CSS, JS, ícones) do PWA: Cache First
  event.respondWith(
    caches.match(request).then(response => {
      return (
        response ||
        fetch(request).then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        })
      );
    })
  );
});
