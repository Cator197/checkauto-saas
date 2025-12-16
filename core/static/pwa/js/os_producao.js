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
    checklist: document.getElementById("listaChecklist"),
    gridFotos: document.getElementById("gridFotosLivres"),
    infoOffline: document.getElementById("infoOffline"),
    observacao: document.getElementById("observacaoEtapa"),
    observacaoStatus: document.getElementById("observacaoStatus"),
    btnCamera: document.getElementById("btnTirarFotos"),
    btnAvancar: document.getElementById("btnAvancarEtapa"),
    inputCamera: document.getElementById("inputFotosEtapa"),
  };

  let state = {
    os_id: osId,
    codigo: `OS ${osId}`,
    placa: "",
    modelo: "",
    etapa_atual: { id: null, nome: "-" },
    obrigatorias: [],
    configs_atendidas_servidor: [],
    configs_atendidas_offline: [],
    fotos_livres_servidor: [],
    fotos_livres_offline: [],
    fotos_obrigatorias_offline: [],
    observacao_etapa: "",
    avancar_solicitado: false,
    pendente_sync: false,
    atualizado_em: null,
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
    state = {
      ...state,
      ...extra,
      atualizado_em: new Date().toISOString(),
    };

    window.checkautoSalvarOSProducao(state);
  }

  function preencherHeader() {
    refs.codigo.textContent = state.codigo || `OS ${osId}`;
    refs.modelo.textContent = state.modelo || "Modelo não informado";
    refs.placa.textContent = state.placa ? `Placa ${state.placa}` : "Placa não informada";
    refs.etapa.textContent = `Etapa atual: ${state.etapa_atual?.nome || "-"}`;
  }

  function checklistAtendida() {
    const feitas = new Set([
      ...(state.configs_atendidas_servidor || []),
      ...(state.configs_atendidas_offline || []),
    ]);
    return state.obrigatorias.every((c) => feitas.has(c.id));
  }

  function proximaObrigatoriaPendente() {
    const feitas = new Set([
      ...(state.configs_atendidas_servidor || []),
      ...(state.configs_atendidas_offline || []),
    ]);
    return state.obrigatorias.find((c) => !feitas.has(c.id));
  }

  function renderChecklist() {
    const feitas = new Set([
      ...(state.configs_atendidas_servidor || []),
      ...(state.configs_atendidas_offline || []),
    ]);

    refs.checklist.innerHTML = "";

    if (!state.obrigatorias.length) {
      refs.checklist.innerHTML = '<li class="muted">Nenhuma configuração obrigatória encontrada para esta etapa.</li>';
      return;
    }

    state.obrigatorias.forEach((item) => {
      const li = document.createElement("li");
      li.className = "check-item";

      const nome = document.createElement("div");
      nome.className = "nome";
      nome.textContent = item.nome || "Foto obrigatória";

      const tag = document.createElement("span");
      const ok = feitas.has(item.id);
      tag.className = `tag ${ok ? "ok" : "pendente"}`;
      tag.textContent = ok ? "tirada" : "pending";

      li.appendChild(nome);
      li.appendChild(tag);
      refs.checklist.appendChild(li);
    });
  }

  function renderFotosLivres() {
    const fotos = [
      ...(state.fotos_livres_servidor || []),
      ...(state.fotos_livres_offline || []),
    ];

    refs.gridFotos.innerHTML = "";

    if (!fotos.length) {
      refs.gridFotos.innerHTML = '<p class="muted">Nenhuma foto livre encontrada para esta etapa.</p>';
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
    refs.btnAvancar.disabled = !checklistAtendida();
  }

  async function carregarDoCache() {
    const salvo = await window.checkautoBuscarOSProducao(osId);
    if (salvo) {
      state = { ...state, ...salvo };
      preencherHeader();
      renderChecklist();
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
      state = { ...state, codigo: `OS ${item.codigo || osId}`, placa: item.placa, modelo: item.modelo_veiculo, etapa_atual: item.etapa_atual };
      preencherHeader();
    }

    return false;
  }

  async function buscarConfigsDaEtapa(etapaId, token) {
    const url = new URL(window.location.origin + "/api/config-fotos/");
    url.searchParams.set("etapa", etapaId);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).filter((c) => c.obrigatoria);
  }

  async function buscarFotosDaEtapa(osId, etapaId, token) {
    const url = new URL(window.location.origin + "/api/fotos-os/");
    url.searchParams.set("os", osId);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).filter((f) => f.etapa === etapaId || f.etapa_id === etapaId);
  }

  async function buscarOnline() {
    const token = localStorage.getItem("checkauto_token");
    if (!token) {
      setStatus("Token não encontrado. Exibindo dados locais.");
      return;
    }

    try {
      setStatus("Atualizando do servidor…");
      const osResp = await fetch(`/api/os/${osId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!osResp.ok) {
        setStatus("Não foi possível atualizar agora.");
        return;
      }

      const osData = await osResp.json();
      const etapaId = osData.etapa_atual || osData.etapa_atual_id || null;
      const etapaNome = osData.etapa_atual_nome || osData.etapa_atual?.nome || "-";

      let configsObrigatorias = [];
      let fotosNaEtapa = [];

      if (etapaId) {
        configsObrigatorias = await buscarConfigsDaEtapa(etapaId, token);
        fotosNaEtapa = await buscarFotosDaEtapa(osId, etapaId, token);
      }

      const configsAtendidasServidor = fotosNaEtapa
        .map((f) => f.config_foto)
        .filter(Boolean);

      const fotosLivresServidor = fotosNaEtapa
        .filter((f) => !f.config_foto)
        .map((f) => ({
          id: f.id,
          origem: "servidor",
          thumb_url: f.drive_thumb_url || f.drive_url,
          etapa_id: f.etapa,
        }));

      const observacaoEtapa = state.observacao_etapa || osData.observacoes || "";

      salvarCache({
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapa_atual: { id: etapaId, nome: etapaNome },
        obrigatorias: configsObrigatorias,
        configs_atendidas_servidor: configsAtendidasServidor,
        fotos_livres_servidor: fotosLivresServidor,
        observacao_etapa: observacaoEtapa,
      });

      state = {
        ...state,
        codigo: `OS ${osData.codigo || osId}`,
        placa: osData.placa,
        modelo: osData.modelo_veiculo,
        etapa_atual: { id: etapaId, nome: etapaNome },
        obrigatorias: configsObrigatorias,
        configs_atendidas_servidor: configsAtendidasServidor,
        fotos_livres_servidor: fotosLivresServidor,
        observacao_etapa: observacaoEtapa,
      };

      preencherHeader();
      renderChecklist();
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
    renderChecklist();
    renderFotosLivres();
    renderObservacao();
    atualizarBotoes();
  }

  const salvarObservacaoDebounce = debounce((valor) => {
    salvarCache({ observacao_etapa: valor, pendente_sync: true });
    refs.observacaoStatus.textContent = "Observação salva localmente (aguardando sync).";
  }, 350);

  refs.observacao.addEventListener("input", (e) => {
    const valor = e.target.value;
    salvarObservacaoDebounce(valor);
  });

  refs.btnCamera.addEventListener("click", () => {
    refs.inputCamera?.click();
  });

  refs.inputCamera.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = function (ev) {
        const dataUrl = ev.target.result;
        const pendente = proximaObrigatoriaPendente();

        if (pendente) {
          state.configs_atendidas_offline = [
            ...(state.configs_atendidas_offline || []),
            pendente.id,
          ];
        }

        const fotoObj = {
          id: `local-${Date.now()}-${Math.random()}`,
          origem: "offline",
          dataUrl,
          etapa_id: state.etapa_atual?.id,
          config_foto: pendente?.id || null,
        };

        if (!pendente) {
          state.fotos_livres_offline = [...(state.fotos_livres_offline || []), fotoObj];
        } else {
          state.fotos_obrigatorias_offline = [
            ...(state.fotos_obrigatorias_offline || []),
            fotoObj,
          ];
        }

        salvarCache({
          configs_atendidas_offline: state.configs_atendidas_offline,
          fotos_livres_offline: state.fotos_livres_offline,
          fotos_obrigatorias_offline: state.fotos_obrigatorias_offline,
          pendente_sync: true,
        });

        renderChecklist();
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

    if (navigator.onLine) {
      await buscarOnline();
    } else {
      setStatus("Offline. Usando dados salvos.");
    }

    window.addEventListener("online", buscarOnline);
  })();
});

