// static/pwa/js/os_producao.js
// Tela de produção do veículo com dados offline

document.addEventListener("DOMContentLoaded", () => {
  const osId = parseInt(document.body.dataset.osId, 10);

  const refs = {
    codigo: document.getElementById("osCodigo"),
    modelo: document.getElementById("osModelo"),
    placa: document.getElementById("osPlaca"),
    etapa: document.getElementById("osEtapa"),
    status: document.getElementById("osStatus"),
    gridFotos: document.getElementById("gridFotosLivres"),
    infoOffline: document.getElementById("infoOffline"),
    observacao: document.getElementById("observacaoEtapa"),
    observacaoStatus: document.getElementById("observacaoStatus"),
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
    os_id: osId,
    codigo: `OS ${osId}`,
    placa: "",
    modelo: "",
    etapa_atual: { id: null, nome: "-" },
    fotos_livres_servidor: [],
    fotos_livres_offline: [],
    fotos_obrigatorias_offline: [],
    observacao_etapa: "",
    avancar_solicitado: false,
    pendente_sync: false,
    atualizado_em: null,
  };

  const cameraSession = {
    ativo: false,
  };

  const debounce = (fn, wait = 300) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  function setStatus(texto) {
    if (refs.status) {
      refs.status.textContent = texto;
    }
  }

  function salvarCache(extra = {}) {
    const extraProcessado = { ...extra };

    state = {
      ...state,
      ...extraProcessado,
      atualizado_em: new Date().toISOString(),
    };

    window.checkautoSalvarOSProducao(state);
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
    refs.etapa.textContent = `Etapa atual: ${state.etapa_atual?.nome || "-"}`;
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

  function renderFotosLivres() {
    const fotos = [
      ...(state.fotos_livres_servidor || []),
      ...(state.fotos_livres_offline || []),
      ...(state.fotos_obrigatorias_offline || []),
    ];

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
      badge.className = "foto-badge";
      badge.textContent = foto.origem === "offline" ? "offline" : "servidor";

      card.appendChild(img);
      card.appendChild(badge);
      refs.gridFotos.appendChild(card);
    });
  }

  function renderObservacao() {
    const valor = state.observacao_etapa || "";
    if (refs.observacao.value !== valor) {
      refs.observacao.value = valor;
    }
  }

  function atualizarBotoes() {
    if (refs.btnAvancar) {
      refs.btnAvancar.disabled = false;
    }
  }

  async function carregarDoCache() {
    const salvo = await window.checkautoBuscarOSProducao(osId);
    if (salvo) {
      state = {
        ...state,
        ...salvo,
      };
      preencherHeader();
      renderFotosLivres();
      renderObservacao();
      atualizarBotoes();
      setStatus("Dados carregados do dispositivo (offline).");
      return true;
    }

    // fallback: usa dados da lista de veículos em produção
    const lista = await window.checkautoBuscarVeiculosEmProducao();
    const item = (lista || []).find((v) => v.os_id === osId);
    if (item) {
      salvarCache({
        codigo: `OS ${item.codigo || osId}`,
        placa: item.placa || "",
        modelo: item.modelo_veiculo || "",
        etapa_atual: item.etapa_atual || { id: null, nome: "-" },
      });
      state = {
        ...state,
        codigo: `OS ${item.codigo || osId}`,
        placa: item.placa,
        modelo: item.modelo_veiculo,
        etapa_atual: item.etapa_atual,
      };
      preencherHeader();
    }

    return false;
  }

  async function buscarFotosDaEtapa(osId, etapaId) {
    const url = new URL(window.location.origin + "/api/fotos-os/");
    url.searchParams.set("os", osId);

    const resp = await apiFetch(url.toString());

    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).filter((f) => f.etapa === etapaId || f.etapa_id === etapaId);
  }

  async function buscarOnline() {
    const token = getAccessToken();
    if (!token) {
      setStatus("Token não encontrado. Exibindo dados locais.");
      redirectAfterLogout("pwa");
      return;
    }

    try {
      setStatus("Atualizando do servidor…");
      const osResp = await apiFetch(`/api/os/${osId}/`);

      if (!osResp.ok) {
        setStatus("Não foi possível atualizar agora.");
        return;
      }

      const osData = await osResp.json();
      const etapaId = osData.etapa_atual || osData.etapa_atual_id || null;
      const etapaNome = osData.etapa_atual_nome || osData.etapa_atual?.nome || "-";

      let fotosNaEtapa = [];

      if (etapaId) {
        fotosNaEtapa = await buscarFotosDaEtapa(osId, etapaId);
      }

      const fotosServidor = fotosNaEtapa.map((f) => ({
        id: f.id,
        origem: "servidor",
        thumb_url: f.drive_thumb_url || f.drive_url,
        etapa_id: f.etapa || f.etapa_id,
        config_foto: f.config_foto,
        config_foto_id: f.config_foto_id,
      }));

      const observacaoEtapa =
        state.observacao_etapa ||
        osData.observacao_etapa_atual ||
        osData.observacoes ||
        "";

      salvarCache({
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapa_atual: { id: etapaId, nome: etapaNome },
        fotos_livres_servidor: fotosServidor,
        observacao_etapa: observacaoEtapa,
      });

      state = {
        ...state,
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapa_atual: { id: etapaId, nome: etapaNome },
        fotos_livres_servidor: fotosServidor,
        observacao_etapa: observacaoEtapa,
      };

      preencherHeader();
      renderFotosLivres();
      renderObservacao();
      atualizarBotoes();
      setStatus("Dados atualizados do servidor.");
    } catch (err) {
      console.error("Erro ao buscar dados online da OS:", err);
      setStatus("Erro ao atualizar. Mostrando cache.");
    }
  }

  function renderTudo() {
    preencherHeader();
    renderFotosLivres();
    renderObservacao();
    atualizarBotoes();
  }

  const salvarObservacaoDebounce = debounce((valor) => {
    salvarCache({ observacao_etapa: valor, pendente_sync: true });
    refs.observacaoStatus.textContent = "Observação salva localmente (aguardando sync).";
    if (window.checkautoEnfileirarObservacaoOS) {
      window.checkautoEnfileirarObservacaoOS(osId, {
        texto: valor,
        etapa: state.etapa_atual?.id,
      });
    }
  }, 350);

  refs.observacao.addEventListener("input", (e) => {
    const valor = e.target.value;
    salvarObservacaoDebounce(valor);
  });

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
          origem: "offline",
          dataUrl,
          etapa_id: state.etapa_atual?.id,
          tipo: "LIVRE",
        };

        state.fotos_livres_offline = [...(state.fotos_livres_offline || []), fotoObj];

        salvarCache({
          fotos_livres_offline: state.fotos_livres_offline,
          fotos_obrigatorias_offline: state.fotos_obrigatorias_offline,
          pendente_sync: true,
        });

        if (window.checkautoEnfileirarFotoOS) {
          window.checkautoEnfileirarFotoOS(
            osId,
            {
              dataUrl,
              etapa_id: state.etapa_atual?.id,
              tipo: "LIVRE",
            },
            { pendente_sync: true }
          );
        }

        renderFotosLivres();
        atualizarBotoes();
        refs.infoOffline.textContent = "Novas fotos salvas localmente. Serão enviadas no próximo sync.";
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  });

  refs.btnAvancar.addEventListener("click", () => {
    state.avancar_solicitado = true;
    salvarCache({ avancar_solicitado: true, pendente_sync: true });
    refs.btnAvancar.textContent = "Agendado para próxima etapa";
    refs.btnAvancar.disabled = true;
    refs.observacaoStatus.textContent = "Avanço agendado. Será enviado no próximo sync.";
  });

  (async function iniciar() {
    await carregarDoCache();
    renderTudo();
    aplicarPermissoes();

    if (navigator.onLine) {
      await buscarOnline();
    } else {
      setStatus("Offline. Usando dados salvos.");
    }

    window.addEventListener("online", buscarOnline);
  })();
});

