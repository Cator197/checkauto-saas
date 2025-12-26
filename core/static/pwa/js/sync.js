// static/pwa/js/sync.js
// Lógica da tela de sincronização do PWA

let syncEmAndamento = false;
let statusPendencias = {};

function formatarTipo(tipo) {
  switch (tipo) {
    case "PATCH_OS":
      return "Alteração de etapa";
    case "POST_FOTO_OS":
      return "Upload de foto";
    case "UPSERT_OBSERVACAO":
      return "Observação da etapa";
    case "AVANCAR_ETAPA":
      return "Avançar etapa";
    default:
      return tipo || "Desconhecido";
  }
}

function statusInicial(item) {
  if (item.last_error) {
    return { texto: "erro", detalhe: item.last_error };
  }
  return { texto: "pendente", detalhe: null };
}

function dataUrlParaArquivo(dataUrl, filename) {
  try {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new File([u8arr], filename, { type: mime });
  } catch (err) {
    console.error("Erro ao converter dataURL para arquivo:", err);
    return null;
  }
}

function normalizarIdEtapaLocal(valor) {
  if (valor === undefined) return null;

  const possivel = valor?.id ?? valor?.etapa_atual ?? valor?.etapa_atual_id ?? valor;
  const numero = parseInt(possivel, 10);

  if (Number.isNaN(numero)) return null;

  return numero;
}

async function buscarEtapaRemota(osId) {
  try {
    const resp = await apiFetch(`/api/os/${osId}/`);
    if (!resp.ok) return { etapa: null, data: null };

    const data = await resp.clone().json().catch(() => null);
    const etapa = normalizarIdEtapaLocal(data?.etapa_atual ?? data?.etapa_atual_id);

    return { etapa, data };
  } catch (err) {
    console.warn("Falha ao buscar etapa atual remota da OS", osId, err);
    return { etapa: null, data: null };
  }
}

async function obterEtapaOrigemParaAvanco(item) {
  let etapaOrigem = normalizarIdEtapaLocal(item.payload?.etapa_origem);
  let dadosRemotos = null;

  if (!etapaOrigem && window.checkautoBuscarOSProducao) {
    try {
      const cache = await window.checkautoBuscarOSProducao(item.os_id);
      etapaOrigem = normalizarIdEtapaLocal(cache?.etapa_atual);
    } catch (err) {
      console.warn("Erro ao buscar etapa local para avanço de etapa", err);
    }
  }

  if (!etapaOrigem) {
    const remoto = await buscarEtapaRemota(item.os_id);
    etapaOrigem = remoto.etapa;
    dadosRemotos = remoto.data;

    if (etapaOrigem && item?.id && window.checkautoAtualizarItemFilaSync) {
      await window.checkautoAtualizarItemFilaSync(item.id, {
        payload: { ...(item.payload || {}), etapa_origem: etapaOrigem },
      });
    }
  }

  return { etapaOrigem, dadosRemotos };
}

async function limparAvancosDuplicados(osId, manterId = null) {
  if (!window.checkautoListarFilaSync) return;

  const fila = await window.checkautoListarFilaSync();
  const duplicatas = fila.filter(
    (item) =>
      item.type === "AVANCAR_ETAPA" &&
      item.os_id === osId &&
      (manterId ? item.id !== manterId : true)
  );

  if (!duplicatas.length) return;

  await Promise.all(duplicatas.map((item) => window.checkautoRemoverItemFilaSync(item.id)));

  if (window.checkautoRemoverOperacaoProducao) {
    await Promise.all(
      duplicatas.map((item) => window.checkautoRemoverOperacaoProducao(osId, item.id))
    );
  }
}

async function sincronizarItem(item) {
  try {
    let resp = null;
    let data = null;
    let dadosRemotos = null;

    if (item.type === "PATCH_OS") {
      resp = await apiFetch(`/api/os/${item.os_id}/`, {
        method: "PATCH",
        body: item.payload,
      });
    } else if (item.type === "POST_FOTO_OS") {
      const arquivo = dataUrlParaArquivo(
        item.payload?.dataUrl,
        `foto-os-${item.os_id}-${Date.now()}.jpg`
      );

      if (!arquivo) {
        throw new Error("Foto inválida para upload");
      }

      const formData = new FormData();
      formData.append("os", item.os_id);
      if (item.payload?.etapa_id) {
        formData.append("etapa", item.payload.etapa_id);
      }
      if (item.payload?.config_foto_id) {
        formData.append("config_foto", item.payload.config_foto_id);
      }
      formData.append("arquivo", arquivo);

      resp = await apiFetch(`/api/fotos-os/`, {
        method: "POST",
        body: formData,
      });
    } else if (item.type === "UPSERT_OBSERVACAO") {
      const payload = { ...(item.payload || {}) };

      if (payload.etapa_id && !payload.etapa) {
        payload.etapa = payload.etapa_id;
        delete payload.etapa_id;
      }

      if (payload.etapa !== undefined) {
        const etapaNumero = parseInt(payload.etapa, 10);
        if (!Number.isNaN(etapaNumero)) {
          payload.etapa = etapaNumero;
        }
      }

      resp = await apiFetch(`/api/os/${item.os_id}/observacoes/`, {
        method: "POST",
        body: payload,
      });
    } else if (item.type === "AVANCAR_ETAPA") {
      const body = {};

      const { etapaOrigem, dadosRemotos: dadosPreFetch } = await obterEtapaOrigemParaAvanco(item);
      dadosRemotos = dadosPreFetch;
      const etapaFinal = etapaOrigem ?? null;

      if (!etapaFinal) {
        console.warn(
          `Avanço de etapa para OS ${item.os_id} sem etapa_origem local; enviando com fallback.`
        );
      }

      if (item.payload?.observacao) {
        body.observacao = item.payload.observacao;
      }

      body.etapa_origem = etapaFinal;

      resp = await apiFetch(`/api/os/${item.os_id}/avancar-etapa/`, {
        method: "POST",
        body,
      });
    }

    if (!resp) {
      throw new Error("Tipo de operação desconhecido");
    }

    if (!resp.ok) {
      const texto = `Erro ${resp.status || "desconhecido"}`;
      await window.checkautoRegistrarErroFilaSync(item.id, texto);
      return { ok: false, mensagem: texto };
    }

    try {
      data = await resp.clone().json();
    } catch (err) {
      data = null;
    }

    await window.checkautoRemoverItemFilaSync(item.id);
    if (window.checkautoRemoverOperacaoProducao) {
      await window.checkautoRemoverOperacaoProducao(item.os_id, item.id);
    }

    if (item.type === "AVANCAR_ETAPA") {
      await limparAvancosDuplicados(item.os_id, item.id);

      const possuiEtapa = (dados) =>
        dados &&
        (dados.etapa_atual !== undefined ||
          dados.etapa_atual_id !== undefined ||
          dados.etapa_atual_nome !== undefined ||
          (dados.etapa_atual && typeof dados.etapa_atual === "object"));

      let dadosParaAplicar = data;

      if (!possuiEtapa(dadosParaAplicar) && dadosRemotos) {
        dadosParaAplicar = dadosRemotos;
      }

      if (!possuiEtapa(dadosParaAplicar)) {
        const atualizado = await buscarEtapaRemota(item.os_id);
        dadosParaAplicar = atualizado.data || dadosParaAplicar;
      }

      if (dadosParaAplicar && window.checkautoAplicarEtapaOS) {
        await window.checkautoAplicarEtapaOS(item.os_id, {
          id: dadosParaAplicar.etapa_atual ?? dadosParaAplicar.etapa_atual_id ?? null,
          nome: dadosParaAplicar.etapa_atual_nome || dadosParaAplicar.etapa_atual?.nome,
        });
      }
    }

    return { ok: true, mensagem: "Sincronizado", data };
  } catch (err) {
    const mensagem = err?.message || "Falha ao sincronizar";
    await window.checkautoRegistrarErroFilaSync(item.id, mensagem);
    return { ok: false, mensagem };
  }
}

function renderPendencias(lista) {
  const listaDiv = document.getElementById("listaPendentes");
  const spanQtd = document.getElementById("qtdPendentes");

  if (spanQtd) {
    spanQtd.textContent = (lista?.length || 0).toString();
  }

  if (!listaDiv) return;

  listaDiv.innerHTML = "";

  if (!lista || lista.length === 0) {
    listaDiv.innerHTML = "<p>Nenhuma pendência encontrada.</p>";
    return;
  }

  lista.forEach((item) => {
    const status = statusPendencias[item.id] || statusInicial(item);
    const div = document.createElement("div");
    div.className = "os-item";
    div.innerHTML = `
      <div class="os-header">
        <strong>${formatarTipo(item.type)}</strong>
        <span class="status-badge status-${status.texto}">${
          status.texto === "pendente"
            ? "Pendente"
            : status.texto === "processando"
              ? "Processando"
              : status.texto === "erro"
                ? `Erro` + (status.detalhe ? ` (${status.detalhe})` : "")
                : "Sincronizado"
        }</span>
      </div>
      <div class="os-meta">OS ${item.os_id || "—"}</div>
      <div class="os-meta">Criado em: ${
        item.created_at ? new Date(item.created_at).toLocaleString() : "—"
      }</div>
      <div class="os-meta">Tentativas: ${item.tries || 0}</div>
    `;

    listaDiv.appendChild(div);
  });
}

async function carregarPendencias() {
  const fila = window.checkautoListarFilaSync
    ? await window.checkautoListarFilaSync()
    : [];
  renderPendencias(fila);
  return fila;
}

async function processarFilaSync() {
  const statusBox = document.getElementById("syncStatus");

  if (syncEmAndamento) {
    if (statusBox) {
      statusBox.textContent = "Já existe uma sincronização em andamento.";
    }
    return;
  }

  if (!navigator.onLine) {
    if (statusBox) {
      statusBox.textContent = "❌ Sem internet. Conecte-se e tente novamente.";
    }
    return;
  }

  syncEmAndamento = true;
  if (statusBox) {
    statusBox.textContent = "📤 Sincronizando pendências…";
  }

  try {
    const pendencias = await carregarPendencias();
    if (!pendencias.length) {
      if (statusBox) {
        statusBox.textContent = "Nenhuma pendência para sincronizar.";
      }
      syncEmAndamento = false;
      return;
    }

    for (const item of pendencias) {
      if (item.type === "AVANCAR_ETAPA" && (!item.payload || item.payload.etapa_origem == null)) {
        console.warn(
          `OS ${item.os_id} será enviada sem etapa_origem local. Tentando recuperar antes do envio.`
        );
        if (statusBox) {
          statusBox.textContent =
            "⚠️ Etapa local desconhecida; tentando recuperar estado antes de avançar.";
        }
      }

      statusPendencias[item.id] = { texto: "processando" };
      renderPendencias(pendencias);

      const resultado = await sincronizarItem(item);
      statusPendencias[item.id] = resultado.ok
        ? { texto: "sincronizado" }
        : { texto: "erro", detalhe: resultado.mensagem };

      renderPendencias(await carregarPendencias());
    }

    if (statusBox) {
      statusBox.textContent = "✅ Fila de sincronização processada.";
    }
  } catch (err) {
    console.error("Erro ao processar fila de sync:", err);
    if (statusBox) {
      statusBox.textContent = "❌ Falha na sincronização. Verifique sua conexão.";
    }
  } finally {
    syncEmAndamento = false;
    renderPendencias(await carregarPendencias());
    if (window.checkautoAtualizarContadoresHome) {
      window.checkautoAtualizarContadoresHome();
    }
  }
}

async function processarFilaSyncBackground(onItemSuccess) {
  if (syncEmAndamento || !navigator.onLine) {
    return;
  }

  syncEmAndamento = true;

  try {
    const pendencias = await carregarPendencias();

    for (const item of pendencias) {
      const resultado = await sincronizarItem(item);

      if (resultado.ok && typeof onItemSuccess === "function") {
        await onItemSuccess(item, resultado.data);
      }
    }
  } catch (err) {
    console.error("Erro ao processar fila de sync em segundo plano:", err);
  } finally {
    syncEmAndamento = false;
    if (window.checkautoAtualizarContadoresHome) {
      window.checkautoAtualizarContadoresHome();
    }
  }
}

window.addEventListener("online", () => {
  carregarPendencias();
  if (!syncEmAndamento) {
    processarFilaSync();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const btnSync = document.getElementById("btnSync");
  await carregarPendencias();

  if (btnSync) {
    btnSync.addEventListener("click", () => processarFilaSync());
  }
});

// Expor para outros módulos se necessário
window.processarFilaSync = processarFilaSync;
window.processarFilaSyncBackground = processarFilaSyncBackground;
