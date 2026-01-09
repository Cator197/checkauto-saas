// static/pwa/js/veiculos_em_producao.js
// Tela de veículos em produção: busca online + cache IndexedDB

document.addEventListener("DOMContentLoaded", () => {
  const isDev =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const listaEl = document.getElementById("listaVeiculos");
  const statusEl = document.getElementById("statusVeiculos");

  const ETAPAS_CACHE_KEY = "checkauto_pwa_etapas_cache";
  let etapasCache = { nomes: {}, lista: [] };
  let etapasOrdenadas = [];
  let listaAtual = [];
  const proximaEtapaCache = new Map();

  function obterProximaEtapaCache(osId, etapaAtualId) {
    const item = proximaEtapaCache.get(osId);
    if (!item) return undefined;
    if (item.etapaId !== etapaAtualId) return undefined;
    return item.proxima;
  }

  function salvarProximaEtapaCache(osId, etapaAtualId, proxima) {
    proximaEtapaCache.set(osId, { etapaId: etapaAtualId, proxima });
  }

  function carregarCacheLocalEtapas() {
    try {
      const salvo = localStorage.getItem(ETAPAS_CACHE_KEY);
      if (!salvo) {
        etapasCache = { nomes: {}, lista: [] };
        return;
      }

      const parsed = JSON.parse(salvo);

      if (Array.isArray(parsed)) {
        etapasCache = {
          nomes: parsed.reduce((acc, etapa) => {
            if (etapa?.id != null && etapa?.nome) {
              acc[etapa.id] = etapa.nome;
            }
            return acc;
          }, {}),
          lista: parsed,
        };
        etapasOrdenadas = parsed;
        return;
      }

      etapasCache = {
        nomes: parsed?.nomes || parsed || {},
        lista: Array.isArray(parsed?.lista) ? parsed.lista : [],
      };
      etapasOrdenadas = etapasCache.lista || [];
    } catch (err) {
      etapasCache = { nomes: {}, lista: [] };
    }
  }

  function salvarCacheLocalEtapas() {
    try {
      const payload = { nomes: etapasCache.nomes || {}, lista: etapasOrdenadas };
      localStorage.setItem(ETAPAS_CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      logDev("Não foi possível salvar cache de etapas", err);
    }
  }

  function registrarEtapaNoCache(etapa) {
    if (!etapa || typeof etapa !== "object") return;
    if (etapa.id == null) return;

    if (!etapasCache.nomes) {
      etapasCache.nomes = {};
    }

    etapasCache.nomes[etapa.id] = etapa.nome || "-";
  }

  function ordenarEtapas(lista) {
    if (!Array.isArray(lista)) return [];

    return [...lista].sort((a, b) => {
      const ordemA = a?.ordem ?? a?.id ?? 0;
      const ordemB = b?.ordem ?? b?.id ?? 0;

      if (ordemA === ordemB) {
        return (a?.id ?? 0) - (b?.id ?? 0);
      }

      return ordemA - ordemB;
    });
  }

  async function carregarEtapasDaApi() {
    try {
      const resp = await apiFetch("/api/etapas/");
      if (!resp.ok) return;

      const lista = await resp.json();
      etapasOrdenadas = ordenarEtapas(lista || []);
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

    const nomeCache = etapasCache?.nomes?.[etapaAtual];
    return { id: etapaAtual, nome: nomeCache || "—" };
  }

  function obterEtapasOrdenadas() {
    if (etapasOrdenadas.length) return etapasOrdenadas;
    if (Array.isArray(etapasCache?.lista)) {
      etapasOrdenadas = etapasCache.lista;
    }

    return etapasOrdenadas;
  }

  function calcularProximaEtapa(etapaAtualId) {
    const etapas = obterEtapasOrdenadas();
    if (!etapas.length || etapaAtualId == null) return null;

    const idx = etapas.findIndex((etapa) => etapa?.id === etapaAtualId);
    if (idx === -1) return null;

    return etapas[idx + 1] || null;
  }

  async function buscarProximaEtapa(osId, etapaAtualId) {
    const cache = obterProximaEtapaCache(osId, etapaAtualId);
    if (cache !== undefined) {
      return cache;
    }

    if (navigator.onLine) {
      try {
        const resp = await apiFetch(`/api/etapas/proxima/?os=${osId}`);
        if (resp.ok) {
          const data = await resp.json();
          const proxima = data?.proxima_etapa || null;
          salvarProximaEtapaCache(osId, etapaAtualId, proxima);
          return proxima;
        }
      } catch (err) {
        logDev("Falha ao buscar próxima etapa online", err);
      }
    }

    const fallback = calcularProximaEtapa(etapaAtualId);
    salvarProximaEtapaCache(osId, etapaAtualId, fallback);
    return fallback;
  }

  async function normalizarListaComEtapas(lista) {
    if (!Array.isArray(lista)) return [];

    const precisaBuscarEtapas = lista.some(
      (item) =>
        item &&
        typeof item.etapa_atual === "number" &&
        !etapasCache?.nomes?.[item.etapa_atual]
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

  async function anexarProximasEtapas(lista) {
    if (!Array.isArray(lista)) return [];

    const itensComProxima = await Promise.all(
      lista.map(async (item) => {
        const proxima = await buscarProximaEtapa(
          item.os_id,
          item.etapa_atual?.id ?? null
        );

        return {
          ...item,
          proxima_etapa: proxima,
        };
      })
    );

    return itensComProxima;
  }

  async function anexarPendenciasLocais(lista) {
    if (!Array.isArray(lista) || !window.checkautoListarOSProducaoPendentes) {
      return lista || [];
    }

    const pendentes = await window.checkautoListarOSProducaoPendentes();
    const mapaPendentes = new Map((pendentes || []).map((p) => [p.os_id, p]));

    return (lista || []).map((item) => {
      const pendente = mapaPendentes.get(item.os_id);
      if (!pendente) return item;

      const fila = Array.isArray(pendente.fila_sync) ? pendente.fila_sync : [];
      const etapaPendente = pendente.etapa_atual?.id
        ? normalizarEtapa(pendente.etapa_atual)
        : item.etapa_atual;

      return {
        ...item,
        etapa_atual: etapaPendente,
        fila_sync: fila,
        pendente_sync: Boolean(pendente.pendente_sync || pendente.avancar_solicitado || fila.length > 0),
      };
    });
  }

  function logDev(...args) {
    if (isDev) {
      console.debug("[veiculos_em_producao]", ...args);
    }
  }

  function mostrarMensagem(msg, tipo = "info", { retry = false } = {}) {
    if (statusEl) {
      if (retry) {
        statusEl.innerHTML = `
          <span>${msg}</span>
          <button type="button" class="pwa-btn pwa-btn-secondary pwa-btn-retry">Tentar novamente</button>
        `;
        const btnRetry = statusEl.querySelector(".pwa-btn-retry");
        if (btnRetry) {
          btnRetry.addEventListener("click", () => {
            buscarOnline();
          });
        }
      } else {
        statusEl.textContent = msg;
      }
      statusEl.classList.remove("state-loading", "state-empty", "state-error", "state-offline", "state-info");
      statusEl.classList.add(`state-${tipo}`);
    }
  }

  function renderizar(lista) {
    listaAtual = lista || [];
    listaEl.innerHTML = "";

    if (!listaAtual || listaAtual.length === 0) {
      listaEl.innerHTML = '<div class="state-empty">Nenhum veículo em produção.</div>';
      return;
    }

    listaAtual.forEach((item) => {
      const etapaNome = item.etapa_atual?.nome || "—";
      const proximaEtapa =
        item.hasOwnProperty("proxima_etapa")
          ? item.proxima_etapa
          : calcularProximaEtapa(item.etapa_atual?.id);
      const proximaNome =
        proximaEtapa === null
          ? "Última etapa"
          : proximaEtapa?.nome || "—";
      const pendenteSync = item.pendente_sync || (item.fila_sync || []).length > 0;

      const card = document.createElement("div");
      card.className = "pwa-card card-veiculo vehicle-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.innerHTML = `
        <div class="vehicle-card__top">
          <span class="vehicle-plate">${item.placa || "Sem placa"}</span>
          <span class="badge badge-stage">${etapaNome}</span>
        </div>
        <div class="vehicle-meta">
          <div class="vehicle-model">${item.modelo_veiculo || "Modelo não informado"}</div>
          <div class="vehicle-os">OS ${item.codigo || "-"}</div>
          <div class="vehicle-next-stage">Próxima etapa: ${proximaNome}</div>
        </div>
        ${pendenteSync ? '<div class="vehicle-footer"><span class="badge badge-pendente">Pendente de sync</span></div>' : ""}
      `;

      const abrirOS = () => {
        window.location.href = `/pwa/os/${item.os_id}/`;
      };

      card.addEventListener("click", abrirOS);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          abrirOS();
        }
      });

      listaEl.appendChild(card);
    });
  }

  async function carregarDoCache() {
    const cache = await window.checkautoBuscarVeiculosEmProducao();
    if (cache && cache.length) {
      const lista = await normalizarListaComEtapas(cache);
      const listaComPendencias = await anexarPendenciasLocais(lista);
      const listaComProxima = await anexarProximasEtapas(listaComPendencias);
      renderizar(listaComProxima);
      mostrarMensagem("Exibindo lista salva (offline).", "offline");
    } else {
      renderizar([]);
      mostrarMensagem("Nenhum dado salvo. Conecte-se para atualizar.", "offline");
    }
  }

  async function buscarOnline() {
    const token = getAccessToken();
    if (!token) {
      mostrarMensagem("Token não encontrado. Faça login para carregar os veículos.", "error");
      logDev("Token ausente no storage (localStorage)");
      redirectAfterLogout("pwa");
      return;
    }

    proximaEtapaCache.clear();

    try {
      if (window.checkautoBuscarVeiculosEmProducao) {
        const listaLocal = await window.checkautoBuscarVeiculosEmProducao();

        const algumSemModelo = (listaLocal || []).some(
          (item) => !item?.modelo_veiculo || item.modelo_veiculo.trim() === ""
        );

        if (algumSemModelo) {
          mostrarMensagem("Modelo do veículo não pode ser vazio!", "error");
          return;
        }
      }

      mostrarMensagem("Buscando veículos em produção…", "loading");
      const response = await apiFetch("/api/pwa/veiculos-em-producao/");

      if (!response.ok) {
        if (response.status === 401) {
          mostrarMensagem("Sessão expirada. Faça login novamente.", "error", { retry: true });
          logDev("Resposta 401 ao buscar veículos (token expirado ou inválido)");
          return;
        }

        mostrarMensagem("Falha ao buscar lista no servidor.", "error", { retry: true });
        return;
      }

      const data = await response.json();
      const listaNormalizada = await normalizarListaComEtapas(data);
      const listaComPendencias = await anexarPendenciasLocais(listaNormalizada);
      const listaComProxima = await anexarProximasEtapas(listaComPendencias);

      await window.checkautoSalvarVeiculosEmProducao(listaComProxima);
      renderizar(listaComProxima);
      mostrarMensagem("Lista atualizada do servidor.", "info");
    } catch (err) {
      console.error("Erro ao buscar veículos em produção:", err);
      mostrarMensagem("Erro ao atualizar. Mostrando cache.", "error", { retry: true });
      await carregarDoCache();
    }
  }

  async function iniciar() {
    carregarCacheLocalEtapas();
    await carregarDoCache();

    if (navigator.onLine) {
      await buscarOnline();
    } else {
      mostrarMensagem("Offline. Usando a última lista salva.", "offline");
    }
  }

  window.checkautoSincronizarVeiculosEmProducao = buscarOnline;

  window.addEventListener("online", () => {
    buscarOnline();
  });

  iniciar();
});
