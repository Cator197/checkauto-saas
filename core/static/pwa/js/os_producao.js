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
    observacao: document.getElementById("observacaoTexto"),
    observacaoStatus: document.getElementById("observacaoStatus"),
    observacaoForm: document.getElementById("observacaoForm"),
    observacoesLista: document.getElementById("observacoesLista"),
    btnAdicionarObservacao: document.getElementById("btnAdicionarObservacao"),
    btnSalvarObservacao: document.getElementById("btnSalvarObservacao"),
    btnCancelarObservacao: document.getElementById("btnCancelarObservacao"),
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

  let isSavingObservacao = false;

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
      const textoPayload = item.payload?.texto || "";
      const etapaPayload = item.payload?.etapa ?? item.payload?.etapa_id ?? null;
      const atuais = Array.isArray(state.observacoes) ? state.observacoes : [];
      const pendentes = atuais.filter((obs) => obs.status_sync === "pending");
      const server = atuais.filter((obs) => obs.status_sync !== "pending");
      const pendentesFiltradas = pendentes.filter((obs) => {
        if (textoPayload && obs.texto !== textoPayload) return true;
        if (etapaPayload == null) return false;
        return obs.etapa_id && Number(obs.etapa_id) !== Number(etapaPayload);
      });
      if (data) {
        const observacao = normalizarObservacaoItem(data);
        state = {
          ...state,
          observacoes: mergeObservacoes([...server, observacao], pendentesFiltradas),
        };
      } else {
        state = {
          ...state,
          observacoes: mergeObservacoes(server, pendentesFiltradas),
        };
      }

      salvarCache({ observacoes: state.observacoes });
      renderObservacoesLista();
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
      observacoes_etapas_cache: state.observacoes,
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
    refs.placa.textContent = state.placa || "—";
    refs.etapa.textContent = state.etapaAtualNome
      ? `Etapa atual: ${state.etapaAtualNome}`
      : "Etapa atual —";
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

  function renderObservacao() {
    const valor = state.observacaoEtapa || "";
    if (refs.observacao.value !== valor) {
      refs.observacao.value = valor;
    }
    if (valor && refs.observacaoForm) {
      refs.observacaoForm.style.display = "flex";
    }
  }

  function formatarDataHora(valor) {
    if (!valor) return "—";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "—";
    return data.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function normalizarObservacaoItem(item) {
    if (!item) return null;
    return {
      id: item.id ?? null,
      local_id: item.local_id ?? null,
      etapa_id: item.etapa ?? item.etapa_id ?? null,
      texto: item.texto || "",
      criado_em: item.criado_em || item.created_at || item.atualizado_em || null,
      criado_por_nome: item.criado_por_nome || item.usuario_nome || "Você",
      status_sync: item.status_sync || "synced",
    };
  }

  function ordenarObservacoes(lista) {
    return [...lista].sort((a, b) => {
      const dataA = a.criado_em ? new Date(a.criado_em).getTime() : 0;
      const dataB = b.criado_em ? new Date(b.criado_em).getTime() : 0;
      if (dataA !== dataB) return dataB - dataA;
      const idA = a.id || a.local_id || 0;
      const idB = b.id || b.local_id || 0;
      return idB > idA ? 1 : -1;
    });
  }

  function renderObservacoesLista() {
    if (!refs.observacoesLista) return;
    refs.observacoesLista.innerHTML = "";

    const observacoes = ordenarObservacoes(state.observacoes || []);

    if (!observacoes.length) {
      refs.observacoesLista.innerHTML =
        '<p class="pwa-muted">Nenhuma observação registrada nesta etapa.</p>';
      return;
    }

    observacoes.forEach((obs) => {
      const item = document.createElement("div");
      item.className = "pwa-observacao-item";
      if (obs.status_sync === "pending") {
        item.classList.add("pwa-observacao-pendente");
      }

      const texto = document.createElement("div");
      texto.textContent = obs.texto || "—";

      const meta = document.createElement("div");
      meta.className = "pwa-observacao-meta";
      meta.textContent = `${obs.criado_por_nome || "—"} • ${formatarDataHora(
        obs.criado_em
      )}`;

      item.appendChild(texto);
      item.appendChild(meta);

      if (obs.status_sync === "pending") {
        const badge = document.createElement("span");
        badge.className = "pwa-observacao-badge";
        badge.textContent = "Pendente";
        meta.appendChild(badge);
      }

      refs.observacoesLista.appendChild(item);
    });
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

      const observacoesPendentes = extrairObservacoesPendentes(filaSync, etapaAtual.id);
      const observacoesMescladas = mergeObservacoes(
        Array.isArray(salvo.observacoes_etapas_cache)
          ? salvo.observacoes_etapas_cache
          : [],
        observacoesPendentes
      );

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
        observacoes: observacoesMescladas,
        avancar_solicitado: Boolean(salvo.avancar_solicitado),
        pendente_sync: Boolean(salvo.pendente_sync),
        fila_sync: Array.isArray(salvo.fila_sync) ? salvo.fila_sync : [],
      };

      preencherHeader();
      renderEtapaHeader({ etapa_atual: etapaAtual, faltam_fotos_obrigatorias: state.faltamFotosObrigatorias });
      renderFotosLivres();
      renderObservacao();
      renderObservacoesLista();
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

  async function fetchObservacoes(osId, etapaId) {
    const url = new URL(`${window.location.origin}/api/os/${osId}/observacoes/`);
    if (etapaId != null) {
      url.searchParams.set("etapa", etapaId);
    }

    const resp = await apiFetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data.map(normalizarObservacaoItem).filter(Boolean) : [];
  }

  function extrairObservacoesPendentes(filaSync = [], etapaId) {
    return (filaSync || [])
      .filter((item) => item.type === "UPSERT_OBSERVACAO" && item.os_id === osId)
      .filter((item) => {
        if (etapaId == null) return true;
        const etapaPayload = item.payload?.etapa ?? item.payload?.etapa_id ?? null;
        return etapaPayload == null || Number(etapaPayload) === Number(etapaId);
      })
      .map((item) =>
        normalizarObservacaoItem({
          local_id: item.id,
          texto: item.payload?.texto || "",
          criado_em: item.created_at || new Date().toISOString(),
          etapa_id: item.payload?.etapa ?? item.payload?.etapa_id ?? null,
          criado_por_nome: "Você",
          status_sync: "pending",
        })
      )
      .filter(Boolean);
  }

  function mergeObservacoes(serverItems = [], pendentes = []) {
    const mapa = new Map();
    const pendentesNormalizados = [...(pendentes || [])];
    serverItems.forEach((item) => {
      if (!item) return;
      if (item.status_sync === "pending") {
        pendentesNormalizados.push(item);
        return;
      }
      const chave = item.id ?? item.local_id ?? item.texto;
      mapa.set(`server:${chave}`, { ...item, status_sync: item.status_sync || "synced" });
    });

    pendentesNormalizados.forEach((item) => {
      if (!item) return;
      mapa.set(`local:${item.local_id || item.id || item.texto}`, item);
    });

    return ordenarObservacoes(Array.from(mapa.values()));
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

      const observacaoEtapa = state.observacaoEtapa || "";

      const filaAtual = window.checkautoListarFilaSync
        ? await window.checkautoListarFilaSync()
        : [];
      const pendenteSync = (filaAtual || []).some((item) => item.os_id === osId);
      const observacoesMescladas = await carregarObservacoes(etapaId);

      salvarCache({
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapaAtualId: etapaId,
        etapaAtualNome: etapaNome,
        fotosServer: fotosServidor,
        observacaoEtapa: observacaoEtapa,
        observacoes: observacoesMescladas,
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
        observacoes: observacoesMescladas,
        avancar_solicitado: false,
        pendente_sync: pendenteSync,
        faltamFotosObrigatorias: osData.faltam_fotos_obrigatorias ?? state.faltamFotosObrigatorias,
        proximaEtapa,
      };

      await atualizarFotosOfflineDaEtapa(etapaId);

      preencherHeader();
      renderEtapaHeader({ ...osData, proxima_etapa: proximaEtapa });
      renderFotosLivres();
      renderObservacao();
      renderObservacoesLista();
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
    renderObservacao();
    renderObservacoesLista();
    atualizarBotoes();
  }

  function toggleFormularioObservacao(abrir) {
    if (!refs.observacaoForm) return;
    refs.observacaoForm.style.display = abrir ? "flex" : "none";
    if (abrir && refs.observacao) {
      refs.observacao.focus();
    }
  }

  function adicionarListenerUnico(elemento, evento, handler) {
    if (!elemento) return;
    const chave = `listener${evento}`;
    if (elemento.dataset[chave]) return;
    elemento.dataset[chave] = "true";
    elemento.addEventListener(evento, handler);
  }

  async function adicionarObservacaoNaLista(observacao) {
    if (!observacao) return;
    const atuais = Array.isArray(state.observacoes) ? state.observacoes : [];
    const server = atuais.filter((obs) => obs.status_sync !== "pending");
    const pendentes = atuais.filter((obs) => obs.status_sync === "pending");
    if (observacao.status_sync === "pending") {
      pendentes.push(observacao);
    } else {
      server.push(observacao);
    }
    state = {
      ...state,
      observacoes: mergeObservacoes(server, pendentes),
    };
    salvarCache({ observacoes: state.observacoes });
    renderObservacoesLista();
  }

  async function salvarObservacao() {
    if (!refs.observacao) return;
    if (isSavingObservacao) return;
    const texto = (refs.observacao.value || "").trim();
    if (!texto) {
      refs.observacaoStatus.textContent = "Digite uma observação antes de salvar.";
      return;
    }

    const localId = gerarLocalId();
    refs.observacaoStatus.textContent = "Salvando observação...";
    const etapaId = state.etapaAtualId;
    isSavingObservacao = true;
    if (refs.btnSalvarObservacao) {
      refs.btnSalvarObservacao.disabled = true;
    }

    if (!navigator.onLine) {
      if (window.checkautoEnfileirarObservacaoOS) {
        await window.checkautoEnfileirarObservacaoOS(osId, {
          texto,
          etapa: etapaId,
          local_id: localId,
        });
      } else {
        refs.observacaoStatus.textContent =
          "Sem internet, observação será enviada ao sincronizar.";
      }

      const pendente = normalizarObservacaoItem({
        local_id: localId,
        texto,
        criado_em: new Date().toISOString(),
        etapa_id: etapaId,
        criado_por_nome: "Você",
        status_sync: "pending",
      });

      await adicionarObservacaoNaLista(pendente);
      salvarCache({ observacaoEtapa: "", pendente_sync: true });
      refs.observacao.value = "";
      refs.observacaoStatus.textContent =
        "Sem internet, observação será enviada ao sincronizar.";
      toggleFormularioObservacao(false);
      if (refs.infoOffline) {
        refs.infoOffline.style.display = "inline-flex";
        refs.infoOffline.textContent = "Pendente sync";
      }
      isSavingObservacao = false;
      if (refs.btnSalvarObservacao) {
        refs.btnSalvarObservacao.disabled = false;
      }
      return;
    }

    try {
      const resp = await apiFetch(`/api/os/${osId}/observacoes/`, {
        method: "POST",
        body: {
          texto,
          etapa: etapaId,
          local_id: localId,
        },
      });

      if (!resp.ok) {
        refs.observacaoStatus.textContent =
          "Não foi possível salvar a observação agora.";
        return;
      }

      const data = await resp.json();
      const observacao = normalizarObservacaoItem(data);
      await adicionarObservacaoNaLista(observacao);

      refs.observacao.value = "";
      salvarCache({ observacaoEtapa: "" });
      refs.observacaoStatus.textContent = "Observação salva.";
      toggleFormularioObservacao(false);
    } catch (err) {
      console.error("Erro ao salvar observação:", err);
      refs.observacaoStatus.textContent =
        "Erro ao salvar observação. Tente novamente.";
    } finally {
      isSavingObservacao = false;
      if (refs.btnSalvarObservacao) {
        refs.btnSalvarObservacao.disabled = false;
      }
    }
  }

  async function carregarObservacoes(etapaId) {
    const observacoesServidor = await fetchObservacoes(osId, etapaId);
    const filaAtual = window.checkautoListarFilaSync
      ? await window.checkautoListarFilaSync()
      : [];
    const observacoesPendentes = extrairObservacoesPendentes(filaAtual, etapaId);
    const observacoesMescladas = mergeObservacoes(
      observacoesServidor,
      observacoesPendentes
    );

    state = {
      ...state,
      observacoes: observacoesMescladas,
    };
    salvarCache({ observacoes: observacoesMescladas });
    renderObservacoesLista();
    return observacoesMescladas;
  }

  adicionarListenerUnico(refs.btnAdicionarObservacao, "click", () => {
    toggleFormularioObservacao(true);
  });

  adicionarListenerUnico(refs.btnCancelarObservacao, "click", () => {
    if (refs.observacao) {
      refs.observacao.value = "";
    }
    refs.observacaoStatus.textContent = "";
    toggleFormularioObservacao(false);
  });

  adicionarListenerUnico(refs.btnSalvarObservacao, "click", salvarObservacao);

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
    const observacaoAtual = (refs.observacao?.value || "").trim();
    const possuiObservacao = Boolean(observacaoAtual);
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
    refs.observacaoStatus.textContent = possuiEtapa
      ? "Avanço agendado. Será enviado no próximo sync."
      : "⚠️ Etapa local desconhecida. Enviaremos com fallback do servidor ao sincronizar.";

    if (!possuiEtapa) {
      console.warn(
        `Avanço de etapa enfileirado sem etapa_atual em cache para OS ${osId}. Servidor fará fallback se necessário.`
      );
    }

    if (possuiObservacao && window.checkautoEnfileirarObservacaoOS) {
      await window.checkautoEnfileirarObservacaoOS(osId, {
        texto: observacaoAtual,
        etapa: state.etapaAtualId,
      });
    }

    if (window.checkautoEnfileirarAvancoEtapaOS) {
      await window.checkautoEnfileirarAvancoEtapaOS(
        osId,
        {
          observacao: possuiObservacao ? observacaoAtual : "",
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
