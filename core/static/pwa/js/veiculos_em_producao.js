// static/pwa/js/veiculos_em_producao.js
// Tela de veículos em produção: busca online + cache IndexedDB

document.addEventListener("DOMContentLoaded", () => {
  const TOKEN_KEY = "checkauto_access";
  const isDev =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const listaEl = document.getElementById("listaVeiculos");
  const statusEl = document.getElementById("statusVeiculos");

  const ETAPAS_CACHE_KEY = "checkauto_pwa_etapas_cache";
  let etapasCache = {};

  function carregarCacheLocalEtapas() {
    try {
      const salvo = localStorage.getItem(ETAPAS_CACHE_KEY);
      etapasCache = salvo ? JSON.parse(salvo) : {};
    } catch (err) {
      etapasCache = {};
    }
  }

  function salvarCacheLocalEtapas() {
    try {
      localStorage.setItem(ETAPAS_CACHE_KEY, JSON.stringify(etapasCache));
    } catch (err) {
      logDev("Não foi possível salvar cache de etapas", err);
    }
  }

  function registrarEtapaNoCache(etapa) {
    if (!etapa || typeof etapa !== "object") return;
    if (etapa.id == null) return;

    etapasCache[etapa.id] = etapa.nome || "-";
  }

  async function carregarEtapasDaApi() {
    try {
      const resp = await apiFetch("/api/etapas/");
      if (!resp.ok) return;

      const lista = await resp.json();
      (lista || []).forEach(registrarEtapaNoCache);
      salvarCacheLocalEtapas();
    } catch (err) {
      logDev("Falha ao buscar etapas para cache", err);
    }
  }

  function normalizarEtapa(etapaAtual) {
    if (!etapaAtual) {
      return { id: null, nome: "—" };
    }

    if (typeof etapaAtual === "object") {
      registrarEtapaNoCache(etapaAtual);
      salvarCacheLocalEtapas();

      return {
        id: etapaAtual.id ?? null,
        nome: etapaAtual.nome || "—",
      };
    }

    const nomeCache = etapasCache?.[etapaAtual];
    return { id: etapaAtual, nome: nomeCache || "—" };
  }

  async function normalizarListaComEtapas(lista) {
    if (!Array.isArray(lista)) return [];

    const precisaBuscarEtapas = lista.some(
      (item) => item && typeof item.etapa_atual === "number" && !etapasCache[item.etapa_atual]
    );

    if (precisaBuscarEtapas) {
      await carregarEtapasDaApi();
    }

    return lista.map((item) => ({
      ...item,
      etapa_atual: normalizarEtapa(
        item.etapa_atual || item.etapa_atual_id || item.etapa_atual_obj || null
      ),
    }));
  }

  function logDev(...args) {
    if (isDev) {
      console.debug("[veiculos_em_producao]", ...args);
    }
  }

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
      const etapaNome = item.etapa_atual?.nome || "—";
      const card = document.createElement("div");
      card.className = "card-veiculo";
      card.innerHTML = `
        <div class="card-header">
          <span class="codigo">OS ${item.codigo || "-"}</span>
          <span class="etapa">Etapa atual: ${etapaNome}</span>
        </div>
        <div class="card-body">
          <div class="modelo">${item.modelo_veiculo || "Modelo não informado"}</div>
          <div class="placa">${item.placa || "Sem placa"}</div>
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
      const lista = await normalizarListaComEtapas(cache);
      renderizar(lista);
      mostrarMensagem("Exibindo lista salva (offline).");
    } else {
      renderizar([]);
      mostrarMensagem("Nenhum dado salvo. Conecte-se para atualizar.");
    }
  }

  async function buscarOnline() {
    const token = getAccessToken();
    if (!token) {
      mostrarMensagem("Token não encontrado. Faça login para carregar os veículos.");
      logDev("Token ausente no storage (localStorage)");
      redirectAfterLogout("pwa");
      return;
    }

    try {
      if (window.checkautoBuscarVeiculosEmProducao) {
        const listaLocal = await window.checkautoBuscarVeiculosEmProducao();

        const algumSemModelo = (listaLocal || []).some(
          (item) => !item?.modelo_veiculo || item.modelo_veiculo.trim() === ""
        );

        if (algumSemModelo) {
          mostrarMensagem("Modelo do veículo não pode ser vazio!");
          return;
        }
      }

      mostrarMensagem("Buscando veículos em produção…");
      const response = await apiFetch("/api/pwa/veiculos-em-producao/");

      if (!response.ok) {
        if (response.status === 401) {
          mostrarMensagem("Sessão expirada. Faça login novamente.");
          logDev("Resposta 401 ao buscar veículos (token expirado ou inválido)");
          return;
        }

        mostrarMensagem("Falha ao buscar lista no servidor.");
        return;
      }

      const data = await response.json();
      const listaNormalizada = await normalizarListaComEtapas(data);

      await window.checkautoSalvarVeiculosEmProducao(listaNormalizada);
      renderizar(listaNormalizada);
      mostrarMensagem("Lista atualizada do servidor.");
    } catch (err) {
      console.error("Erro ao buscar veículos em produção:", err);
      mostrarMensagem("Erro ao atualizar. Mostrando cache.");
      await carregarDoCache();
    }
  }

  async function iniciar() {
    carregarCacheLocalEtapas();
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
