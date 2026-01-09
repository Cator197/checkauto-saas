// static/pwa/js/os_producao.js
// Tela de produção do veículo com dados offline

document.addEventListener("DOMContentLoaded", () => {
  const osId = parseInt(document.body.dataset.osId, 10);

  const refs = {
    codigo: document.getElementById("osCodigo"),
    modelo: document.getElementById("osModelo"),
    placa: document.getElementById("osPlaca"),
    etapa: document.getElementById("osEtapa"),
    etapaHeader: document.getElementById("etapaHeader"),
    etapaAtualNome: document.getElementById("etapaAtualNome"),
    etapaObrigatoriasStatus: document.getElementById("etapaObrigatoriasStatus"),
    etapaProximaNome: document.getElementById("etapaProximaNome"),
    status: document.getElementById("osStatus"),
    gridFotos: document.getElementById("gridFotosLivres"),
    infoOffline: document.getElementById("infoOffline"),
    observacaoStatus: document.getElementById("observacaoStatus"),
    btnNovaObservacao: document.getElementById("btnNovaObservacao"),
    blocoNovaObservacao: document.getElementById("blocoNovaObservacao"),
    novaObservacaoTexto: document.getElementById("novaObservacaoTexto"),
    btnAdicionarObservacao: document.getElementById("btnAdicionarObservacao"),
    btnCancelarObservacao: document.getElementById("btnCancelarObservacao"),
    observacaoFeedback: document.getElementById("observacaoFeedback"),
    listaObservacoes: document.getElementById("listaObservacoesEtapa"),
    btnCamera: document.getElementById("btnTirarFotos"),
    btnAvancar: document.getElementById("btnAvancarEtapa"),
    inputCamera: document.getElementById("inputFotosEtapa"),
    overlay: document.getElementById("cameraOverlay"),
    overlayMode: document.getElementById("cameraOverlayMode"),
    overlayTitle: document.getElementById("cameraOverlayTitle"),
    overlaySubtitle: document.getElementById("cameraOverlaySubtitle"),
    overlayCapture: document.getElementById("btnCapturarFoto"),
    overlayClose: document.getElementById("btnFecharOverlay"),
  };

  function obterPapelDoToken() {
    const token = getAccessToken();

    if (!token || token.split(".").length < 2) {
      return null;
    }

    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return (payload?.papel || "").toUpperCase();
    } catch (err) {
      console.warn("Não foi possível ler o papel do token", err);
      return null;
    }
  }

  const isOperador = obterPapelDoToken() === "FUNC";

  let state = {
    osId,
    osOnline: null,
    codigo: `OS ${osId}`,
    placa: "",
    modelo: "",
    etapaAtualId: null,
    etapaAtualNome: "-",
    proximaEtapa: null,
    faltamFotosObrigatorias: null,
    fotosServer: [],
    fotosOffline: [],
    fotosOfflinePorEtapa: {},
    observacaoEtapa: "",
    observacoes: [],
    avancar_solicitado: false,
    pendente_sync: false,
    atualizado_em: null,
    syncBadgesEnabled: true,
    fila_sync: [],
  };

  const cameraSession = {
    ativo: false,
  };

  function normalizarEtapaLocal(etapa) {
    if (!etapa) return { id: null, nome: "-" };

    if (typeof etapa === "number") {
      return { id: etapa, nome: `Etapa ${etapa}` };
    }

    return {
      id: etapa.id ?? etapa.etapa_atual ?? etapa.etapa_atual_id ?? null,
      nome: etapa.nome || etapa.etapa_atual_nome || etapa.nome_etapa || "-",
    };
  }

  function getEtapaAtual(os) {
    return normalizarEtapaLocal({
      id:
        os?.etapa_atual?.id ??
        os?.etapa_atual ??
        os?.etapa_atual_id ??
        os?.etapaAtualId ??
        null,
      nome:
        os?.etapa_atual?.nome ??
        os?.etapa_atual_nome ??
        os?.etapa_nome ??
        os?.etapaAtualNome ??
        "-",
    });
  }

  function normalizarEtapaId(valor) {
    const etapa = valor?.id ?? valor?.etapa_atual ?? valor?.etapa_atual_id ?? valor ?? null;
    const numero = parseInt(etapa, 10);
    return Number.isNaN(numero) ? null : numero;
  }

  function construirFotosOfflinePorEtapa(fotosLivres = [], fotosObrigatorias = []) {
    const mapa = {};
    const inserir = (foto, tipo) => {
      const etapaId = normalizarEtapaId(foto?.etapa_id);
      const chave = etapaId != null ? String(etapaId) : "sem-etapa";
      if (!mapa[chave]) {
        mapa[chave] = { livres: [], obrigatorias: [] };
      }
      mapa[chave][tipo].push(foto);
    };

    fotosLivres.forEach((foto) => inserir(foto, "livres"));
    fotosObrigatorias.forEach((foto) => inserir(foto, "obrigatorias"));

    return mapa;
  }

  function extrairFotosOfflineDaEtapa(mapa, etapaId) {
    const chave = etapaId != null ? String(etapaId) : "sem-etapa";
    const bucket = mapa?.[chave] || { livres: [], obrigatorias: [] };
    return [...(bucket.livres || []), ...(bucket.obrigatorias || [])];
  }

  function listarFotosOfflineTodas(mapa) {
    if (!mapa || typeof mapa !== "object") return [];
    return Object.values(mapa).flatMap((bucket) => [
      ...(bucket.livres || []),
      ...(bucket.obrigatorias || []),
    ]);
  }

  function arredondarMomento(dataIso) {
    if (!dataIso) return null;
    const data = new Date(dataIso);
    if (Number.isNaN(data.getTime())) return null;
    data.setSeconds(0, 0);
    return data.toISOString();
  }

  function construirFallbackKeyFoto(foto) {
    if (!foto) return null;
    const etapaId = normalizarEtapaId(foto.etapa_id || foto.etapa);
    const configId = foto.config_foto_id || foto.config_foto || null;
    const momento =
      arredondarMomento(foto.tirada_em) ||
      arredondarMomento(foto.created_at) ||
      arredondarMomento(foto.criado_em) ||
      null;

    if (etapaId == null || configId == null || !momento) {
      return null;
    }

    return `${etapaId}-${configId}-${momento}`;
  }

  function obterChaveFoto(foto) {
    if (!foto) return { chave: null, fallback: null };
    if (foto.local_id) {
      return { chave: `local:${foto.local_id}`, fallback: null };
    }
    if (foto.id) {
      return { chave: `server:${foto.id}`, fallback: construirFallbackKeyFoto(foto) };
    }
    return { chave: null, fallback: construirFallbackKeyFoto(foto) };
  }

  function construirMapaStatusSync(filaSync = []) {
    const mapa = new Map();
    (filaSync || [])
      .filter((item) => item.type === "POST_FOTO_OS" && item.os_id === osId)
      .forEach((item) => {
        const localId = item.payload?.local_id;
        if (!localId) return;
        mapa.set(localId, {
          status_sync: item.last_error ? "error" : "pending",
          last_error: item.last_error || null,
        });
      });
    return mapa;
  }

  function gerarLocalId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const rand = Math.random() * 16;
      const value = char === "x" ? rand : (rand & 0x3) | 0x8;
      return Math.floor(value).toString(16);
    });
  }

  function coletarMetadadosFotosPendentes() {
    const fotos = listarFotosOfflineTodas(state.fotosOfflinePorEtapa);

    return fotos.map((foto) => ({
      id: foto.local_id || foto.id,
      local_id: foto.local_id || foto.id,
      origem: foto.origem,
      etapa_id: foto.etapa_id,
      tipo: foto.tipo,
      dataUrl: foto.dataUrl || null,
      status_sync: foto.status_sync,
    }));
  }

  async function aoSincronizarItem(item, data) {
    if (item.type === "POST_FOTO_OS") {
      const localId = item.payload?.local_id;
      const fotosServidor = Array.isArray(state.fotosServer) ? state.fotosServer : [];
      const fotoServidor = data
        ? {
            id: data.id,
            origem: "servidor",
            thumb_url: data.thumb_url || data.drive_thumb_url || data.drive_url,
            etapa_id: data.etapa || data.etapa_id,
            config_foto: data.config_foto,
            config_foto_id: data.config_foto_id,
            local_id: data.local_id || null,
            status_sync: "synced",
          }
        : null;

      removerFotoOfflinePorLocalId(localId);

      state = {
        ...state,
        fotosServer: fotoServidor
          ? [...fotosServidor.filter((foto) => foto.id !== fotoServidor.id), fotoServidor]
          : fotosServidor,
      };

      state.fotosOffline = extrairFotosOfflineDaEtapa(
        state.fotosOfflinePorEtapa,
        state.etapaAtualId
      );

      renderFotosLivres();
      return;
    }

    if (item.type === "UPSERT_OBSERVACAO") {
      if (data) {
        const listaAtual = Array.isArray(state.observacoes) ? state.observacoes : [];
        const atualizada = [
          ...listaAtual.filter((obs) => obs?.dedupe_key !== item.dedupe_key),
          data,
        ];
        atualizarObservacoesLocal(atualizada);
      }
      return;
    }

    if (item.type !== "AVANCAR_ETAPA") return;

    const etapaNormalizada = normalizarEtapaLocal({
      id: data?.etapa_atual ?? data?.etapa_atual_id ?? null,
      nome: data?.etapa_atual_nome || data?.etapa_atual?.nome,
    });

    const filaRestante = window.checkautoListarFilaSync
      ? await window.checkautoListarFilaSync()
      : [];
    const aindaPendentes = (filaRestante || []).some(
      (fila) => fila.os_id === osId
    );

    state = {
      ...state,
      etapaAtualId: etapaNormalizada.id,
      etapaAtualNome: etapaNormalizada.nome,
      avancar_solicitado: false,
      pendente_sync: aindaPendentes,
    };

    salvarCache({
      etapaAtualId: etapaNormalizada.id,
      etapaAtualNome: etapaNormalizada.nome,
      avancar_solicitado: false,
      pendente_sync: aindaPendentes,
    });

    if (navigator.onLine && etapaNormalizada.id) {
      const fotosNaEtapa = await fetchServerFotos(osId, etapaNormalizada.id);
      state.fotosServer = fotosNaEtapa.map((f) => ({
        id: f.id,
        origem: "servidor",
        thumb_url: f.thumb_url || f.drive_thumb_url || f.drive_url,
        etapa_id: f.etapa || f.etapa_id,
        config_foto: f.config_foto,
        config_foto_id: f.config_foto_id,
        local_id: f.local_id || null,
        status_sync: "synced",
      }));
      salvarCache({ fotosServer: state.fotosServer });
    }

    await atualizarFotosOfflineDaEtapa(etapaNormalizada.id);
    renderEtapaHeader(state);
    preencherHeader();
    renderizarListaObservacoes(state.etapaAtualId);
    atualizarBotoes();
    refs.btnAvancar.textContent = "Enviar para próxima etapa";
    refs.btnAvancar.disabled = false;
    setStatus("Etapa avançada e sincronizada.", "info");
  }

  async function sincronizarPendenciasSePossivel() {
    if (window.processarFilaSyncBackground && navigator.onLine) {
      await window.processarFilaSyncBackground(aoSincronizarItem);
    }
  }

  function setStatus(texto, tipo = "info") {
    if (!refs.status) return;
    refs.status.textContent = texto;
    refs.status.classList.remove(
      "state-loading",
      "state-empty",
      "state-error",
      "state-offline",
      "state-info"
    );
    refs.status.classList.add(`state-${tipo}`);
  }

  function salvarCache(extra = {}) {
    const extraProcessado = { ...extra };

    state = {
      ...state,
      ...extraProcessado,
      atualizado_em: new Date().toISOString(),
    };

    const fotosOfflineTodas = listarFotosOfflineTodas(state.fotosOfflinePorEtapa);
    const fotosLivres = fotosOfflineTodas.filter((foto) => foto.tipo !== "PADRAO");
    const fotosObrigatorias = fotosOfflineTodas.filter((foto) => foto.tipo === "PADRAO");

    window.checkautoSalvarOSProducao({
      os_id: state.osId,
      codigo: state.codigo,
      placa: state.placa,
      modelo: state.modelo,
      etapa_atual: { id: state.etapaAtualId, nome: state.etapaAtualNome },
      fotos_livres_servidor: state.fotosServer,
      fotos_livres_offline: fotosLivres,
      fotos_obrigatorias_offline: fotosObrigatorias,
      fotos_offline_por_etapa: state.fotosOfflinePorEtapa,
      observacao_etapa: state.observacaoEtapa,
      observacoes: state.observacoes,
      avancar_solicitado: state.avancar_solicitado,
      pendente_sync: state.pendente_sync,
      atualizado_em: state.atualizado_em,
      faltam_fotos_obrigatorias: state.faltamFotosObrigatorias,
      proxima_etapa: state.proximaEtapa,
    });
  }

  function aplicarPermissoes() {
    if (isOperador && refs.btnAvancar) {
      refs.btnAvancar.style.display = "none";
    }
  }

  function preencherHeader() {
    refs.codigo.textContent = state.codigo || `OS ${osId}`;
    refs.modelo.textContent = state.modelo || "Modelo não informado";
    refs.placa.textContent = state.placa ? `Placa ${state.placa}` : "Placa não informada";
    refs.etapa.textContent = `Etapa atual: ${state.etapaAtualNome || "-"}`;
    if (refs.infoOffline) {
      refs.infoOffline.style.display = state.pendente_sync ? "inline-flex" : "none";
    }
  }

  function renderEtapaHeader(os) {
    if (!refs.etapaHeader) return;

    const etapaAtual = getEtapaAtual(os || {});
    const faltam = os?.faltam_fotos_obrigatorias ?? state.faltamFotosObrigatorias;
    const proxima = os?.proxima_etapa ?? state.proximaEtapa;

    if (refs.etapaAtualNome) {
      refs.etapaAtualNome.textContent = etapaAtual.nome || "-";
    }

    if (refs.etapaObrigatoriasStatus) {
      if (typeof faltam === "number") {
        refs.etapaObrigatoriasStatus.textContent =
          faltam > 0
            ? `Obrigatórias pendentes: ${faltam}`
            : "Obrigatórias completas";
        refs.etapaObrigatoriasStatus.className =
          faltam > 0 ? "pwa-badge pwa-badge-warning" : "pwa-badge pwa-badge-success";
      } else {
        refs.etapaObrigatoriasStatus.textContent = "Obrigatórias: —";
        refs.etapaObrigatoriasStatus.className = "pwa-badge pwa-badge-warning";
      }
    }

    if (refs.etapaProximaNome) {
      refs.etapaProximaNome.textContent = proxima?.nome
        ? `Próxima etapa: ${proxima.nome}`
        : "Próxima etapa: —";
    }
  }

  function atualizarOverlayCamera() {
    if (!refs.overlay) return;
    if (refs.overlayTitle) refs.overlayTitle.textContent = "Foto da etapa";
    if (refs.overlayMode) refs.overlayMode.textContent = "Captura";
    if (refs.overlaySubtitle) {
      refs.overlaySubtitle.textContent =
        "Capture fotos desta etapa livremente. Elas ficarão salvas nesta tela e serão sincronizadas quando houver conexão.";
    }
  }

  function abrirOverlayCamera() {
    cameraSession.ativo = true;
    atualizarOverlayCamera();

    if (refs.overlay) {
      refs.overlay.classList.add("show");
    }
  }

  function fecharOverlayCamera() {
    cameraSession.ativo = false;
    if (refs.overlay) {
      refs.overlay.classList.remove("show");
    }
  }

  function mergeFotos(fotosServidor = [], fotosOffline = []) {
    const mapa = new Map();
    const fallbackMap = new Map();

    fotosServidor.forEach((foto) => {
      const { chave, fallback } = obterChaveFoto(foto);
      if (chave) {
        mapa.set(chave, { ...foto, status_sync: "synced" });
      }
      if (fallback && !fallbackMap.has(fallback)) {
        fallbackMap.set(fallback, chave);
      }
    });

    fotosOffline.forEach((foto) => {
      const { chave, fallback } = obterChaveFoto(foto);
      if (chave && mapa.has(chave)) {
        return;
      }

      // fallback é melhor esforço; evita dedupe agressivo sem local_id
      if (fallback && fallbackMap.has(fallback)) {
        return;
      }

      if (chave) {
        mapa.set(chave, foto);
      } else if (fallback) {
        mapa.set(`fallback:${fallback}`, foto);
      }
    });

    return Array.from(mapa.values());
  }

  function renderFotos(fotos) {
    refs.gridFotos.innerHTML = "";

    if (!fotos.length) {
      refs.gridFotos.innerHTML = '<p class="muted">Nenhuma foto encontrada para esta etapa.</p>';
      return;
    }

    fotos.forEach((foto) => {
      const card = document.createElement("div");
      card.className = "foto-card";

      const img = document.createElement("img");
      img.src = foto.thumb_url || foto.dataUrl || foto.drive_thumb_url;

      const badge = document.createElement("span");
      const status = foto.status_sync || (foto.origem === "offline" ? "pending" : "synced");
      badge.className = "foto-badge";
      if (status === "pending") {
        badge.classList.add("foto-badge--pending");
        badge.textContent = "Pendente";
      } else if (status === "error") {
        badge.classList.add("foto-badge--error");
        badge.textContent = "Erro";
      } else {
        badge.textContent = "Servidor";
      }

      card.appendChild(img);
      card.appendChild(badge);

      if (status === "error" && foto.last_error) {
        const erro = document.createElement("div");
        erro.className = "foto-error";
        erro.textContent = foto.last_error;
        card.appendChild(erro);
      }

      refs.gridFotos.appendChild(card);
    });
  }

  function renderFotosLivres() {
    const fotosMescladas = mergeFotos(state.fotosServer, state.fotosOffline);
    renderFotos(fotosMescladas);
  }

  async function atualizarFotosOfflineDaEtapa(etapaId) {
    const filaSync = window.checkautoListarFilaSync
      ? await window.checkautoListarFilaSync()
      : [];
    const mapaStatus = construirMapaStatusSync(filaSync);
    const fotosOffline = extrairFotosOfflineDaEtapa(state.fotosOfflinePorEtapa, etapaId).map(
      (foto) => {
        const localId = foto.local_id || foto.id;
        const statusInfo = mapaStatus.get(localId);
        return {
          ...foto,
          status_sync: statusInfo?.status_sync || foto.status_sync || "pending",
          last_error: statusInfo?.last_error || foto.last_error || null,
        };
      }
    );

    state = {
      ...state,
      fotosOffline,
    };
  }

  function removerFotoOfflinePorLocalId(localId) {
    if (!localId) return;
    const fotosAtualizadas = listarFotosOfflineTodas(state.fotosOfflinePorEtapa).filter(
      (foto) => (foto.local_id || foto.id) !== localId
    );
    state.fotosOfflinePorEtapa = construirFotosOfflinePorEtapa(
      fotosAtualizadas.filter((foto) => foto.tipo !== "PADRAO"),
      fotosAtualizadas.filter((foto) => foto.tipo === "PADRAO")
    );
  }

  function formatarDataHora(valor) {
    if (!valor) return "—";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "—";
    return data.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function obterNomeUsuario(obs) {
    return obs?.criado_por_nome || obs?.usuario_nome || obs?.tirada_por_nome || "Sistema";
  }

  function obterDataObservacao(obs) {
    return obs?.criado_em || obs?.atualizado_em || obs?.data || obs?.created_at || null;
  }

  function obterObservacoesDaEtapa(etapaId, lista = state.observacoes) {
    const observacoes = Array.isArray(lista) ? lista : [];
    return observacoes
      .filter((obs) => {
        const id = typeof obs.etapa === "object" ? obs.etapa?.id : obs.etapa;
        return Number(id) === Number(etapaId);
      })
      .sort(
        (a, b) =>
          new Date(obterDataObservacao(b) || 0) - new Date(obterDataObservacao(a) || 0)
      );
  }

  function criarCardObservacao(obs) {
    const card = document.createElement("div");
    const statusSync = obs?.status_sync;
    card.className = "pwa-observacao-card";
    if (statusSync === "error") {
      card.classList.add("pwa-observacao-card--error");
    }

    const meta = document.createElement("div");
    meta.className = "pwa-observacao-meta";

    const nome = document.createElement("span");
    nome.className = "pwa-observacao-nome";
    nome.textContent = obterNomeUsuario(obs);

    const data = document.createElement("span");
    data.textContent = formatarDataHora(obterDataObservacao(obs));

    meta.appendChild(nome);
    meta.appendChild(document.createTextNode("•"));
    meta.appendChild(data);

    if (statusSync === "pending" || statusSync === "error") {
      const badge = document.createElement("span");
      badge.className = "pwa-observacao-badge";
      badge.textContent = statusSync === "error" ? "Erro sync" : "Pendente";
      meta.appendChild(badge);
    }

    const texto = document.createElement("p");
    texto.className = "pwa-observacao-texto";
    texto.textContent = obs?.texto || "";

    card.appendChild(meta);
    card.appendChild(texto);

    if (statusSync === "error" && obs?.last_error) {
      const erro = document.createElement("div");
      erro.className = "pwa-muted";
      erro.textContent = obs.last_error;
      card.appendChild(erro);
    }

    return card;
  }

  function renderizarListaObservacoes(etapaId) {
    if (!refs.listaObservacoes) return;
    refs.listaObservacoes.innerHTML = "";
    const observacoesEtapa = obterObservacoesDaEtapa(etapaId);
    if (!observacoesEtapa.length) {
      const vazio = document.createElement("p");
      vazio.className = "pwa-muted";
      vazio.textContent = "Sem observações nesta etapa.";
      refs.listaObservacoes.appendChild(vazio);
      return;
    }
    observacoesEtapa.forEach((obs) => {
      refs.listaObservacoes.appendChild(criarCardObservacao(obs));
    });
  }

  function gerarHashTexto(texto) {
    let hash = 5381;
    for (let i = 0; i < texto.length; i += 1) {
      hash = (hash * 33) ^ texto.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  function gerarDedupeKeyObservacao(osRef, etapaId, texto) {
    const textoNormalizado = (texto || "").trim();
    const etapaNormalizada = etapaId ?? "sem-etapa";
    return `${osRef || "sem-os"}-${etapaNormalizada}-${gerarHashTexto(textoNormalizado)}`;
  }

  function extrairPendenciasObservacao(filaSync = []) {
    return (filaSync || [])
      .filter((item) => item.type === "UPSERT_OBSERVACAO" && item.os_id === osId)
      .map((item) => ({
        id: item.id,
        local_id: item.id,
        dedupe_key: item.dedupe_key || null,
        texto: item.payload?.texto || "",
        etapa: item.payload?.etapa ?? item.payload?.etapa_id ?? null,
        criado_em: item.created_at,
        criado_por_nome: "Você",
        status_sync: item.error_permanent ? "error" : "pending",
        last_error: item.last_error || null,
      }));
  }

  function atualizarObservacoesLocal(novasObservacoes) {
    state = {
      ...state,
      observacoes: novasObservacoes,
    };
    salvarCache({ observacoes: novasObservacoes });
    renderizarListaObservacoes(state.etapaAtualId);
  }

  async function carregarObservacoesDaOS() {
    if (!osId) return;
    try {
      const resp = await apiFetch(`/api/os/${osId}/observacoes/`);
      if (!resp.ok) return;
      const data = await resp.json();
      const lista = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];

      const filaSync = window.checkautoListarFilaSync
        ? await window.checkautoListarFilaSync()
        : [];
      const pendentes = extrairPendenciasObservacao(filaSync);
      const pendentesDedupe = new Set(pendentes.map((item) => item.dedupe_key).filter(Boolean));
      const listaFiltrada = lista.filter((obs) => {
        if (!pendentesDedupe.size) return true;
        const dedupe = gerarDedupeKeyObservacao(
          osId,
          typeof obs.etapa === "object" ? obs.etapa?.id : obs.etapa,
          obs?.texto || ""
        );
        return !pendentesDedupe.has(dedupe);
      });

      atualizarObservacoesLocal([...listaFiltrada, ...pendentes]);
    } catch (err) {
      console.warn("Falha ao carregar observações da OS", err);
    }
  }

  function limparFeedbackObservacao() {
    if (!refs.observacaoFeedback) return;
    refs.observacaoFeedback.textContent = "";
    refs.observacaoFeedback.className = "pwa-muted";
  }

  function abrirNovaObservacao() {
    if (refs.blocoNovaObservacao) {
      refs.blocoNovaObservacao.style.display = "block";
    }
    limparFeedbackObservacao();
    refs.novaObservacaoTexto?.focus();
  }

  function fecharNovaObservacao() {
    if (refs.blocoNovaObservacao) {
      refs.blocoNovaObservacao.style.display = "none";
    }
    if (refs.novaObservacaoTexto) {
      refs.novaObservacaoTexto.value = "";
    }
    limparFeedbackObservacao();
  }

  function atualizarBotoes() {
    if (refs.btnAvancar) {
      refs.btnAvancar.disabled = false;
    }
  }

  async function loadOsStateFromCache(osId) {
    const salvo = await window.checkautoBuscarOSProducao(osId);
    if (salvo) {
      const etapaAtual = getEtapaAtual(salvo);
      const fotosLivres = Array.isArray(salvo.fotos_livres_offline)
        ? salvo.fotos_livres_offline
        : [];
      const fotosObrigatorias = Array.isArray(salvo.fotos_obrigatorias_offline)
        ? salvo.fotos_obrigatorias_offline
        : [];
      const fotosOfflinePorEtapa =
        salvo.fotos_offline_por_etapa ||
        construirFotosOfflinePorEtapa(fotosLivres, fotosObrigatorias);
      const fotosServerRaw = Array.isArray(salvo.fotos_livres_servidor)
        ? salvo.fotos_livres_servidor
        : [];
      const fotosServer = fotosServerRaw.filter(
        (foto) => (foto.etapa_id || foto.etapa) === etapaAtual.id
      );

      if (!salvo.fotos_offline_por_etapa && window.checkautoSalvarOSProducao) {
        window.checkautoSalvarOSProducao({
          ...salvo,
          fotos_offline_por_etapa: fotosOfflinePorEtapa,
        });
      }

      const filaSync = window.checkautoListarFilaSync
        ? await window.checkautoListarFilaSync()
        : [];
      const mapaStatus = construirMapaStatusSync(filaSync);
      const observacoesCache = Array.isArray(salvo.observacoes) ? salvo.observacoes : [];
      const observacoesPendentes = extrairPendenciasObservacao(filaSync);
      const pendentesDedupe = new Set(
        observacoesPendentes.map((item) => item.dedupe_key).filter(Boolean)
      );
      const observacoesCombinadas = [
        ...observacoesCache.filter((obs) => {
          if (!pendentesDedupe.size) return true;
          const dedupe = gerarDedupeKeyObservacao(
            osId,
            typeof obs.etapa === "object" ? obs.etapa?.id : obs.etapa,
            obs?.texto || ""
          );
          return !pendentesDedupe.has(dedupe);
        }),
        ...observacoesPendentes,
      ];

      const fotosOfflineEtapa = extrairFotosOfflineDaEtapa(
        fotosOfflinePorEtapa,
        etapaAtual.id
      ).map((foto) => {
        const localId = foto.local_id || foto.id;
        const statusInfo = mapaStatus.get(localId);
        return {
          ...foto,
          status_sync: statusInfo?.status_sync || foto.status_sync || "pending",
          last_error: statusInfo?.last_error || foto.last_error || null,
        };
      });

      state = {
        ...state,
        osOnline: salvo.osOnline || null,
        codigo: salvo.codigo || `OS ${osId}`,
        placa: salvo.placa || "",
        modelo: salvo.modelo || salvo.modelo_veiculo || "",
        etapaAtualId: etapaAtual.id,
        etapaAtualNome: etapaAtual.nome,
        proximaEtapa: salvo.proxima_etapa || null,
        faltamFotosObrigatorias: salvo.faltam_fotos_obrigatorias ?? null,
        fotosServer,
        fotosOfflinePorEtapa,
        fotosOffline: fotosOfflineEtapa,
        observacaoEtapa: salvo.observacao_etapa || "",
        observacoes: observacoesCombinadas,
        avancar_solicitado: Boolean(salvo.avancar_solicitado),
        pendente_sync: Boolean(salvo.pendente_sync),
        fila_sync: Array.isArray(salvo.fila_sync) ? salvo.fila_sync : [],
      };

      preencherHeader();
      renderEtapaHeader({ etapa_atual: etapaAtual, faltam_fotos_obrigatorias: state.faltamFotosObrigatorias });
      renderFotosLivres();
      renderizarListaObservacoes(state.etapaAtualId);
      atualizarBotoes();
      setStatus("Dados carregados do dispositivo (offline).", "offline");
      return true;
    }

    // fallback: usa dados da lista de veículos em produção
    const lista = await window.checkautoBuscarVeiculosEmProducao();
    const item = (lista || []).find((v) => v.os_id === osId);
    if (item) {
      const etapa = getEtapaAtual(item);
      salvarCache({
        codigo: `OS ${item.codigo || osId}`,
        placa: item.placa || "",
        modelo: item.modelo_veiculo || "",
        etapaAtualId: etapa.id,
        etapaAtualNome: etapa.nome,
        faltamFotosObrigatorias: item.faltam_fotos_obrigatorias ?? null,
      });
      state = {
        ...state,
        codigo: `OS ${item.codigo || osId}`,
        placa: item.placa,
        modelo: item.modelo_veiculo,
        etapaAtualId: etapa.id,
        etapaAtualNome: etapa.nome,
        faltamFotosObrigatorias: item.faltam_fotos_obrigatorias ?? null,
      };
      preencherHeader();
      renderEtapaHeader({ etapa_atual: etapa, faltam_fotos_obrigatorias: state.faltamFotosObrigatorias });
    }

    return false;
  }

  async function fetchServerFotos(osId, etapaId) {
    const url = new URL(window.location.origin + "/api/fotos-os/");
    url.searchParams.set("os", osId);
    if (etapaId != null) {
      url.searchParams.set("etapa", etapaId);
    }

    const resp = await apiFetch(url.toString());

    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).filter((f) => f.etapa === etapaId || f.etapa_id === etapaId);
  }

  async function fetchProximaEtapa(osId) {
    try {
      const resp = await apiFetch(`/api/etapas/proxima/?os=${osId}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.proxima_etapa || null;
    } catch (err) {
      console.warn("Falha ao buscar próxima etapa", err);
      return null;
    }
  }

  async function buscarOnline() {
    const token = getAccessToken();
    if (!token) {
      setStatus("Token não encontrado. Exibindo dados locais.", "error");
      redirectAfterLogout("pwa");
      return;
    }

    try {
      setStatus("Atualizando do servidor…", "loading");
      const osResp = await apiFetch(`/api/os/${osId}/`);

      if (!osResp.ok) {
        setStatus("Não foi possível atualizar agora.", "error");
        return;
      }

      const osData = await osResp.json();
      const etapaAtual = getEtapaAtual(osData);
      const etapaId = etapaAtual.id;
      const etapaNome = etapaAtual.nome;

      let fotosNaEtapa = [];
      let proximaEtapa = null;

      if (etapaId) {
        fotosNaEtapa = await fetchServerFotos(osId, etapaId);
      }

      proximaEtapa = await fetchProximaEtapa(osId);

      const fotosServidor = fotosNaEtapa.map((f) => ({
        id: f.id,
        origem: "servidor",
        thumb_url: f.thumb_url || f.drive_thumb_url || f.drive_url,
        etapa_id: f.etapa || f.etapa_id,
        config_foto: f.config_foto,
        config_foto_id: f.config_foto_id,
        local_id: f.local_id || null,
        status_sync: "synced",
      }));

      const observacaoEtapa =
        state.observacaoEtapa || osData.observacao_etapa_atual || osData.observacoes || "";

      const filaAtual = window.checkautoListarFilaSync
        ? await window.checkautoListarFilaSync()
        : [];
      const pendenteSync = (filaAtual || []).some((item) => item.os_id === osId);

      salvarCache({
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapaAtualId: etapaId,
        etapaAtualNome: etapaNome,
        fotosServer: fotosServidor,
        observacaoEtapa: observacaoEtapa,
        avancar_solicitado: false,
        pendente_sync: pendenteSync,
        faltamFotosObrigatorias: osData.faltam_fotos_obrigatorias ?? state.faltamFotosObrigatorias,
        proximaEtapa,
      });

      state = {
        ...state,
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapaAtualId: etapaId,
        etapaAtualNome: etapaNome,
        fotosServer: fotosServidor,
        observacaoEtapa: observacaoEtapa,
        avancar_solicitado: false,
        pendente_sync: pendenteSync,
        faltamFotosObrigatorias: osData.faltam_fotos_obrigatorias ?? state.faltamFotosObrigatorias,
        proximaEtapa,
      };

      await atualizarFotosOfflineDaEtapa(etapaId);

      preencherHeader();
      renderEtapaHeader({ ...osData, proxima_etapa: proximaEtapa });
      renderFotosLivres();
      await carregarObservacoesDaOS();
      atualizarBotoes();
      setStatus("Dados atualizados do servidor.", "info");
    } catch (err) {
      console.error("Erro ao buscar dados online da OS:", err);
      setStatus("Erro ao atualizar. Mostrando cache.", "error");
    }
  }

  function renderTudo() {
    preencherHeader();
    renderEtapaHeader(state);
    renderFotosLivres();
    renderizarListaObservacoes(state.etapaAtualId);
    atualizarBotoes();
  }

  if (refs.btnNovaObservacao) {
    refs.btnNovaObservacao.addEventListener("click", () => {
      abrirNovaObservacao();
    });
  }

  if (refs.btnCancelarObservacao) {
    refs.btnCancelarObservacao.addEventListener("click", () => {
      fecharNovaObservacao();
    });
  }

  if (refs.btnAdicionarObservacao) {
    refs.btnAdicionarObservacao.addEventListener("click", async () => {
      if (!refs.novaObservacaoTexto) return;
      const texto = refs.novaObservacaoTexto.value.trim();
      const etapaId = state.etapaAtualId;

      limparFeedbackObservacao();

      if (!texto || texto.length < 3) {
        if (refs.observacaoFeedback) {
          refs.observacaoFeedback.textContent = "Digite ao menos 3 caracteres.";
          refs.observacaoFeedback.className = "pwa-muted";
        }
        return;
      }

      if (!etapaId) {
        if (refs.observacaoFeedback) {
          refs.observacaoFeedback.textContent = "Etapa atual indisponível.";
          refs.observacaoFeedback.className = "pwa-muted";
        }
        return;
      }

      refs.btnAdicionarObservacao.disabled = true;
      refs.btnAdicionarObservacao.textContent = "Salvando...";

      const payload = { etapa: etapaId, texto };

      try {
        if (navigator.onLine) {
          const resp = await apiFetch(`/api/os/${osId}/observacoes/`, {
            method: "POST",
            body: payload,
          });

          if (!resp.ok) {
            const textoErro = await resp.text();
            throw new Error(textoErro || `Erro ${resp.status}`);
          }

          const salvo = await resp.json();
          const listaAtual = Array.isArray(state.observacoes) ? state.observacoes : [];
          const atualizada = [
            ...listaAtual.filter((obs) => Number(obs?.id) !== Number(salvo?.id)),
            salvo,
          ];
          state.observacaoEtapa = texto;
          atualizarObservacoesLocal(atualizada);
          fecharNovaObservacao();
        } else {
          const dedupeKey = gerarDedupeKeyObservacao(osId, etapaId, texto);
          const pendente = {
            id: `pendente-${Date.now()}-${Math.random()}`,
            local_id: dedupeKey,
            dedupe_key: dedupeKey,
            texto,
            etapa: etapaId,
            criado_em: new Date().toISOString(),
            criado_por_nome: "Você",
            status_sync: "pending",
          };

          if (window.checkautoEnfileirarObservacaoOS) {
            await window.checkautoEnfileirarObservacaoOS(osId, payload, {
              pendente_sync: true,
            });
          }

          const listaAtual = Array.isArray(state.observacoes) ? state.observacoes : [];
          state.observacaoEtapa = texto;
          atualizarObservacoesLocal([...listaAtual, pendente]);
          salvarCache({ pendente_sync: true });
          preencherHeader();
          fecharNovaObservacao();
        }
      } catch (err) {
        if (refs.observacaoFeedback) {
          refs.observacaoFeedback.textContent = "Erro ao salvar observação.";
          refs.observacaoFeedback.className = "pwa-muted";
        }
        console.error("Erro ao salvar observação", err);
      } finally {
        refs.btnAdicionarObservacao.disabled = false;
        refs.btnAdicionarObservacao.textContent = "Adicionar";
      }
    });
  }

  refs.btnCamera.addEventListener("click", () => {
    abrirOverlayCamera();
  });

  if (refs.overlayCapture) {
    refs.overlayCapture.addEventListener("click", () => {
      refs.inputCamera?.click();
    });
  }

  if (refs.overlayClose) {
    refs.overlayClose.addEventListener("click", () => {
      fecharOverlayCamera();
    });
  }

  refs.inputCamera.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = function (ev) {
        const dataUrl = ev.target.result;
        const fotoObj = {
          id: `local-${Date.now()}-${Math.random()}`,
          local_id: gerarLocalId(),
          origem: "offline",
          dataUrl,
          etapa_id: state.etapaAtualId,
          tipo: "LIVRE",
          status_sync: "pending",
          created_at: new Date().toISOString(),
        };

        const fotosOfflineTodas = [
          ...listarFotosOfflineTodas(state.fotosOfflinePorEtapa),
          fotoObj,
        ];
        state.fotosOfflinePorEtapa = construirFotosOfflinePorEtapa(
          fotosOfflineTodas.filter((foto) => foto.tipo !== "PADRAO"),
          fotosOfflineTodas.filter((foto) => foto.tipo === "PADRAO")
        );
        state.fotosOffline = extrairFotosOfflineDaEtapa(
          state.fotosOfflinePorEtapa,
          state.etapaAtualId
        );

        salvarCache({
          fotosOfflinePorEtapa: state.fotosOfflinePorEtapa,
          pendente_sync: true,
        });

        if (window.checkautoEnfileirarFotoOS) {
          window.checkautoEnfileirarFotoOS(
            osId,
            {
              dataUrl,
              etapa_id: state.etapaAtualId,
              tipo: "LIVRE",
              local_id: fotoObj.local_id,
              status_sync: fotoObj.status_sync,
            },
            { pendente_sync: true }
          );
        }

        renderFotosLivres();
        atualizarBotoes();
        if (refs.infoOffline) {
          refs.infoOffline.style.display = "inline-flex";
          refs.infoOffline.textContent = "Pendente sync";
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  });

  refs.btnAvancar.addEventListener("click", async () => {
    const observacaoAtual = state.observacaoEtapa || "";
    const etapaLocal = state.etapaAtualId ?? null;
    const possuiEtapa = etapaLocal !== null && etapaLocal !== undefined;

    state.avancar_solicitado = true;
    state.pendente_sync = true;

    salvarCache({
      observacaoEtapa: observacaoAtual,
      avancar_solicitado: true,
      pendente_sync: true,
    });

    refs.btnAvancar.textContent = "Agendado para próxima etapa";
    refs.btnAvancar.disabled = true;
    if (refs.observacaoStatus) {
      refs.observacaoStatus.textContent = possuiEtapa
        ? "Avanço agendado. Será enviado no próximo sync."
        : "⚠️ Etapa local desconhecida. Enviaremos com fallback do servidor ao sincronizar.";
    }

    if (!possuiEtapa) {
      console.warn(
        `Avanço de etapa enfileirado sem etapa_atual em cache para OS ${osId}. Servidor fará fallback se necessário.`
      );
    }

    if (window.checkautoEnfileirarObservacaoOS) {
      await window.checkautoEnfileirarObservacaoOS(osId, {
        texto: observacaoAtual,
        etapa: state.etapaAtualId,
      });
    }

    if (window.checkautoEnfileirarAvancoEtapaOS) {
      await window.checkautoEnfileirarAvancoEtapaOS(
        osId,
        {
          observacao: observacaoAtual,
          fotos: coletarMetadadosFotosPendentes(),
        },
        { pendente_sync: true, etapa_atual: { id: state.etapaAtualId, nome: state.etapaAtualNome } }
      );
    }

    await sincronizarPendenciasSePossivel();
  });

  (async function iniciar() {
    await loadOsStateFromCache(osId);
    renderTudo();
    aplicarPermissoes();

    if (navigator.onLine) {
      await buscarOnline();
      await sincronizarPendenciasSePossivel();
    } else {
      setStatus("Offline. Usando dados salvos.", "offline");
    }

    window.addEventListener("online", () => {
      buscarOnline();
      sincronizarPendenciasSePossivel();
    });

    window.addEventListener("photoSynced", async (event) => {
      const detalhe = event.detail || {};
      if (detalhe.osId !== osId) return;

      removerFotoOfflinePorLocalId(detalhe.local_id);

      if (detalhe.data) {
        const fotoServidor = {
          id: detalhe.data.id,
          origem: "servidor",
          thumb_url:
            detalhe.data.thumb_url ||
            detalhe.data.drive_thumb_url ||
            detalhe.data.drive_url,
          etapa_id: detalhe.data.etapa || detalhe.data.etapa_id,
          config_foto: detalhe.data.config_foto,
          config_foto_id: detalhe.data.config_foto_id,
          local_id: detalhe.data.local_id || null,
          status_sync: "synced",
        };

        if (fotoServidor.etapa_id === state.etapaAtualId) {
          state.fotosServer = [
            ...state.fotosServer.filter((foto) => foto.id !== fotoServidor.id),
            fotoServidor,
          ];
        }
      }

      await atualizarFotosOfflineDaEtapa(state.etapaAtualId);
      salvarCache({ fotosOfflinePorEtapa: state.fotosOfflinePorEtapa, fotosServer: state.fotosServer });
      renderFotosLivres();
    });
  })();
});
