// static/pwa/js/app.js
// Registro do Service Worker e funções globais simples

// Registro do Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/static/pwa/service-worker.js")
      .then((registration) => {
        console.log("Service Worker registrado com sucesso:", registration.scope);
      })
      .catch((error) => {
        console.error("Falha ao registrar o Service Worker:", error);
      });
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
});
