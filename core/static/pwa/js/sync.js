// static/pwa/js/sync.js
// Lógica da tela de sincronização do PWA

document.addEventListener("DOMContentLoaded", async () => {
  const btnSync = document.getElementById("btnSync");
  const statusBox = document.getElementById("syncStatus");
  const listaDiv = document.getElementById("listaPendentes");
  const spanQtd = document.getElementById("qtdPendentes");

  async function carregarProducoesPendentes() {
    if (!window.checkautoListarOSProducaoPendentes) return [];
    return await window.checkautoListarOSProducaoPendentes();
  }

  async function atualizarVeiculosEmProducao() {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    try {
      const response = await apiFetch("/api/pwa/veiculos-em-producao/");

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (window.checkautoSalvarVeiculosEmProducao) {
        await window.checkautoSalvarVeiculosEmProducao(data);
      }

      if (window.checkautoSincronizarVeiculosEmProducao) {
        window.checkautoSincronizarVeiculosEmProducao();
      }
    } catch (err) {
      console.error("Erro ao atualizar veículos em produção após sync:", err);
    }
  }

  async function carregarPendencias() {
    const pendentes = await window.checkautoBuscarOSPendentes();
    spanQtd.textContent = pendentes.length.toString();

    listaDiv.innerHTML = "";

    if (pendentes.length === 0) {
      listaDiv.innerHTML = "<p>Nenhuma OS pendente encontrada.</p>";
      return pendentes;
    }

    pendentes.forEach((os) => {
      const div = document.createElement("div");
      div.className = "os-item";
      div.innerHTML = `
        <strong>ID Offline:</strong> ${os.id}<br>
        <strong>Placa:</strong> ${os.veiculo?.placa || "-"}<br>
        <strong>Tipo:</strong> ${os.tipo}<br>
        <strong>Criado em:</strong> ${new Date(os.criadoEm).toLocaleString()}
      `;
      listaDiv.appendChild(div);
    });

    return pendentes;
  }

  // Renderiza as pendências ao entrar na tela
  let pendenciasAtuais = await carregarPendencias();
  let producoesPendentes = await carregarProducoesPendentes();

  btnSync.addEventListener("click", async () => {
    statusBox.innerHTML = "⏳ Preparando sincronização…";

    if (!navigator.onLine) {
      statusBox.innerHTML = "❌ Sem internet. Conecte-se e tente novamente.";
      return;
    }

    if (pendenciasAtuais.length === 0 && producoesPendentes.length === 0) {
      statusBox.innerHTML = "Nenhuma pendência para sincronizar.";
      return;
    }

    try {
      statusBox.innerHTML = "📤 Enviando dados para o servidor…";

      // 🔴 IMPORTANTE: pegar o token salvo e mandar no header
      const token = getAccessToken();
      console.log("Token usado na sincronização:", token); // debug

      if (!token) {
        statusBox.innerHTML = "❌ Você precisa estar logado para sincronizar (token não encontrado).";
        redirectAfterLogout("pwa");
        return;
      }

      const response = await apiFetch("/api/sync/", {
        method: "POST",
        body: {
          osPendentes: pendenciasAtuais,
          producaoPendencias: producoesPendentes,
        },
      });

      if (!response.ok) {
        statusBox.innerHTML = "❌ Erro no servidor ao sincronizar.";
        console.log("Status da resposta /api/sync/:", response.status, response.statusText);
        return;
      }

      const data = await response.json();
      console.log("Resposta da API:", data);

      // Remover OS enviadas do IndexedDB
      const db = await window.checkautoOpenDB();
      await new Promise((resolve) => {
        const tx = db.transaction("osPendentes", "readwrite");
        const store = tx.objectStore("osPendentes");

        pendenciasAtuais.forEach((item) => store.delete(item.id));

        tx.oncomplete = resolve;
      });

      statusBox.innerHTML = "✅ Sincronização concluída com sucesso!";
      pendenciasAtuais = await carregarPendencias();
      producoesPendentes = await carregarProducoesPendentes();

      if (window.checkautoAtualizarContadoresHome) {
        window.checkautoAtualizarContadoresHome();
      }

      await atualizarVeiculosEmProducao();

      // Limpa flags de pendência local das telas de produção
      if (Array.isArray(producoesPendentes)) {
        for (const prod of producoesPendentes) {
          if (window.checkautoMarcarOSProducaoSincronizada) {
            await window.checkautoMarcarOSProducaoSincronizada(prod.os_id);
          }
        }
      }

    } catch (err) {
      console.error("Erro na sincronização:", err);
      statusBox.innerHTML = "❌ Falha na sincronização. Verifique sua conexão.";
    }
  });
});
