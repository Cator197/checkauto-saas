// static/pwa/js/app.js
// Registro do Service Worker e funções globais simples

// Registro do Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/pwa/service-worker.js", { scope: "/pwa/" })
      .then((registration) => {
        console.log("Service Worker registrado com sucesso:", registration.scope);
        checkautoSetupServiceWorkerUpdates(registration);
      })
      .catch((error) => {
        console.error("Falha ao registrar o Service Worker:", error);
      });
  });
}

let checkautoHasReloaded = false;

function checkautoShowUpdateBanner(registration) {
  const banner = document.getElementById("pwaUpdateBanner");
  const button = document.getElementById("pwaUpdateButton");
  if (!banner || !button) {
    return;
  }

  banner.hidden = false;
  button.onclick = () => {
    button.disabled = true;
    button.textContent = "Atualizando...";
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  };
}

function checkautoSetupServiceWorkerUpdates(registration) {
  if (registration.waiting) {
    checkautoShowUpdateBanner(registration);
  }

  registration.addEventListener("updatefound", () => {
    const newWorker = registration.installing;
    if (!newWorker) {
      return;
    }

    newWorker.addEventListener("statechange", () => {
      if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
        checkautoShowUpdateBanner(registration);
      }
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (checkautoHasReloaded) {
      return;
    }
    checkautoHasReloaded = true;
    window.location.reload();
  });
}

// Atualiza os contadores da Home (OS pendentes, fotos pendentes)
async function checkautoAtualizarContadoresHome() {
  const spanOs = document.getElementById("osPendentes");
  const spanFotos = document.getElementById("fotosPendentes");

  if (!spanOs && !spanFotos) {
    return;
  }

  try {
    const pendentes = await window.checkautoBuscarOSPendentes();
    const filaSync = window.checkautoListarFilaSync
      ? await window.checkautoListarFilaSync()
      : [];
    if (spanOs) {
      const totalPendencias = pendentes.length + (filaSync?.length || 0);
      spanOs.textContent = totalPendencias.toString();
    }

    if (spanFotos) {
      const fotosPendentes = (filaSync || []).filter(
        (item) => item.type === "POST_FOTO_OS"
      );
      spanFotos.textContent = fotosPendentes.length.toString();
    }
  } catch (e) {
    console.error("Erro ao atualizar contadores da Home:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  checkautoAtualizarContadoresHome();
  const statusBadge = document.getElementById("pwaStatusBadge");
  const homeOfflineBadge = document.getElementById("homeOfflineBadge");
  if (!statusBadge && !homeOfflineBadge) {
    return;
  }

  const atualizarStatusOnline = () => {
    const online = navigator.onLine;
    if (statusBadge) {
      statusBadge.textContent = online ? "Online" : "Offline";
      statusBadge.classList.toggle("pwa-badge-success", online);
      statusBadge.classList.toggle("pwa-badge-danger", !online);
    }
    if (homeOfflineBadge) {
      homeOfflineBadge.textContent = online ? "Online" : "Offline";
      homeOfflineBadge.classList.toggle("pwa-badge-success", online);
      homeOfflineBadge.classList.toggle("pwa-badge-warning", !online);
    }
  };

  atualizarStatusOnline();
  window.addEventListener("online", atualizarStatusOnline);
  window.addEventListener("offline", atualizarStatusOnline);
});
