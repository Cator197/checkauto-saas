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

  function mostrarMensagem(msg) {
    if (statusEl) {
      statusEl.textContent = msg;
    }
  }

  function renderizar(lista) {
    listaAtual = lista || [];
    listaEl.innerHTML = "";

    if (!listaAtual || listaAtual.length === 0) {
      listaEl.innerHTML = '<p class="muted">Nenhum veículo em produção.</p>';
      return;
    }

    listaAtual.forEach((item) => {
      const etapaNome = item.etapa_atual?.nome || "—";
      const proximaEtapa = calcularProximaEtapa(item.etapa_atual?.id);
      const proximaNome = proximaEtapa ? proximaEtapa.nome || "—" : "Última etapa";
      const pendenteSync = item.pendente_sync || (item.fila_sync || []).length > 0;

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
          <div class="proxima">Próxima: ${proximaNome}</div>
        </div>
        <div class="card-footer">
          ${pendenteSync ? '<span class="badge badge-pendente">Pendente de sync</span>' : ""}
          <button class="btn-primario" ${!proximaEtapa ? "disabled" : ""}>Enviar para próxima etapa</button>
        </div>
      `;

      const btnAvancar = card.querySelector(".btn-primario");

      if (btnAvancar && proximaEtapa) {
        btnAvancar.addEventListener("click", (ev) => {
          ev.stopPropagation();
          enviarParaProximaEtapa(item, proximaEtapa);
        });
      }

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
      const listaComPendencias = await anexarPendenciasLocais(lista);
      renderizar(listaComPendencias);
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
      const listaComPendencias = await anexarPendenciasLocais(listaNormalizada);

      await window.checkautoSalvarVeiculosEmProducao(listaComPendencias);
      renderizar(listaComPendencias);
      mostrarMensagem("Lista atualizada do servidor.");
    } catch (err) {
      console.error("Erro ao buscar veículos em produção:", err);
      mostrarMensagem("Erro ao atualizar. Mostrando cache.");
      await carregarDoCache();
    }
  }

  function atualizarListaLocal(osId, etapaAtual, pendenteSync, fila = []) {
    listaAtual = (listaAtual || []).map((item) => {
      if (item.os_id !== osId) return item;

      return {
        ...item,
        etapa_atual: etapaAtual,
        pendente_sync: pendenteSync,
        fila_sync: fila,
      };
    });

    renderizar(listaAtual);
    window.checkautoSalvarVeiculosEmProducao(listaAtual);
  }

  async function registrarPendencia(osItem, proximaEtapa, payload) {
    const etapaNormalizada = normalizarEtapa(proximaEtapa);
    const pendencia = await window.checkautoEnfileirarPatchOS(
      osItem.os_id,
      payload,
      { etapa_atual: etapaNormalizada }
    );
    const fila = Array.isArray(pendencia?.fila_sync) ? pendencia.fila_sync : [];

    atualizarListaLocal(osItem.os_id, etapaNormalizada, true, fila);
    mostrarMensagem("Enfileirado para sincronização.");
    alert("Enfileirado para sincronização.");
  }

  async function enviarParaProximaEtapa(osItem, proximaEtapa) {
    const payload = { etapa_atual: proximaEtapa.id };
    const etapaNormalizada = normalizarEtapa(proximaEtapa);

    if (!navigator.onLine) {
      await registrarPendencia(osItem, etapaNormalizada, payload);
      return;
    }

    try {
      const resp = await apiFetch(`/api/os/${osItem.os_id}/`, {
        method: "PATCH",
        body: payload,
      });

      if (resp.ok) {
        atualizarListaLocal(osItem.os_id, etapaNormalizada, false, []);
        if (window.checkautoMarcarOSProducaoSincronizada) {
          await window.checkautoMarcarOSProducaoSincronizada(osItem.os_id);
        }
        mostrarMensagem("Etapa atualizada.");
        alert("Etapa atualizada.");
        return;
      }

      await registrarPendencia(osItem, etapaNormalizada, payload);
    } catch (err) {
      logDev("Erro ao enviar etapa online, enfileirando", err);
      await registrarPendencia(osItem, etapaNormalizada, payload);
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
