// Nome do cache (mude a versão quando fizer mudanças grandes no front)
const CACHE_NAME = "checkauto-pwa-v1";

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
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

// Evento de ativação: limpa caches antigos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
});

// Evento de fetch: responde com cache quando possível
self.addEventListener("fetch", event => {
  const request = event.request;

  // Para chamadas de navegação (HTML), tenta rede primeiro, fallback para cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match("/pwa/");
      })
    );
    return;
  }

  // Para assets estáticos (CSS, JS, ícones): Cache First
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
