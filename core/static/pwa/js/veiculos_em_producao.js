// static/pwa/js/veiculos_em_producao.js
// Tela de veículos em produção: busca online + cache IndexedDB

document.addEventListener("DOMContentLoaded", () => {
  const listaEl = document.getElementById("listaVeiculos");
  const statusEl = document.getElementById("statusVeiculos");

  function mostrarMensagem(msg) {
    if (statusEl) {
      statusEl.textContent = msg;
    }
  }

  function renderizar(lista) {
    listaEl.innerHTML = "";

    if (!lista || lista.length === 0) {
      listaEl.innerHTML = '<p class="muted">Nenhum veículo em produção.</p>';
      return;
    }

    lista.forEach((item) => {
      const card = document.createElement("div");
      card.className = "card-veiculo";
      card.innerHTML = `
        <div class="card-header">
          <span class="codigo">OS ${item.codigo || "-"}</span>
          <span class="etapa">${item.etapa_atual?.nome || "Sem etapa"}</span>
        </div>
        <div class="card-body">
          <div class="modelo">${item.modelo_veiculo || "Modelo não informado"}</div>
          <div class="placa">${item.placa || "Sem placa"}</div>
        </div>
        <div class="card-footer">
          <span class="faltam">Faltam ${item.faltam_fotos_obrigatorias || 0} fotos obrigatórias</span>
        </div>
      `;

      card.addEventListener("click", () => {
        window.location.href = `/pwa/os/${item.os_id}/`;
      });

      listaEl.appendChild(card);
    });
  }

  async function carregarDoCache() {
    const cache = await window.checkautoBuscarVeiculosEmProducao();
    if (cache && cache.length) {
      renderizar(cache);
      mostrarMensagem("Exibindo lista salva (offline).");
    } else {
      renderizar([]);
      mostrarMensagem("Nenhum dado salvo. Conecte-se para atualizar.");
    }
  }

  async function buscarOnline() {
    const token = localStorage.getItem("checkauto_token");
    if (!token) {
      mostrarMensagem("Token não encontrado. Faça login para carregar os veículos.");
      return;
    }

    try {
      mostrarMensagem("Buscando veículos em produção…");
      const response = await fetch("/api/pwa/veiculos-em-producao/", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        mostrarMensagem("Falha ao buscar lista no servidor.");
        return;
      }

      const data = await response.json();
      await window.checkautoSalvarVeiculosEmProducao(data);
      renderizar(data);
      mostrarMensagem("Lista atualizada do servidor.");
    } catch (err) {
      console.error("Erro ao buscar veículos em produção:", err);
      mostrarMensagem("Erro ao atualizar. Mostrando cache.");
      await carregarDoCache();
    }
  }

  async function iniciar() {
    await carregarDoCache();

    if (navigator.onLine) {
      await buscarOnline();
    } else {
      mostrarMensagem("Offline. Usando a última lista salva.");
    }
  }

  window.checkautoSincronizarVeiculosEmProducao = buscarOnline;

  window.addEventListener("online", () => {
    buscarOnline();
  });

  iniciar();
});
