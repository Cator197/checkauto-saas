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

async function sincronizarItem(item) {
  try {
    let resp = null;

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
    }

    if (!resp) {
      throw new Error("Tipo de operação desconhecido");
    }

    if (!resp.ok) {
      const texto = `Erro ${resp.status || "desconhecido"}`;
      await window.checkautoRegistrarErroFilaSync(item.id, texto);
      return { ok: false, mensagem: texto };
    }

    await window.checkautoRemoverItemFilaSync(item.id);
    if (window.checkautoRemoverOperacaoProducao) {
      await window.checkautoRemoverOperacaoProducao(item.os_id, item.id);
    }

    return { ok: true, mensagem: "Sincronizado" };
  } catch (err) {
    const mensagem = err?.message || "Falha ao sincronizar";
    await window.checkautoRegistrarErroFilaSync(item.id, mensagem);
    return { ok: false, mensagem };
  }
}

function renderPendencias(lista) {
  const listaDiv = document.getElementById("listaPendentes");
  const spanQtd = document.getElementById("qtdPendentes");

  spanQtd.textContent = (lista?.length || 0).toString();
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
    statusBox.textContent = "Já existe uma sincronização em andamento.";
    return;
  }

  if (!navigator.onLine) {
    statusBox.textContent = "❌ Sem internet. Conecte-se e tente novamente.";
    return;
  }

  syncEmAndamento = true;
  statusBox.textContent = "📤 Sincronizando pendências…";

  try {
    const pendencias = await carregarPendencias();
    if (!pendencias.length) {
      statusBox.textContent = "Nenhuma pendência para sincronizar.";
      syncEmAndamento = false;
      return;
    }

    for (const item of pendencias) {
      statusPendencias[item.id] = { texto: "processando" };
      renderPendencias(pendencias);

      const resultado = await sincronizarItem(item);
      statusPendencias[item.id] = resultado.ok
        ? { texto: "sincronizado" }
        : { texto: "erro", detalhe: resultado.mensagem };

      renderPendencias(await carregarPendencias());
    }

    statusBox.textContent = "✅ Fila de sincronização processada.";
  } catch (err) {
    console.error("Erro ao processar fila de sync:", err);
    statusBox.textContent = "❌ Falha na sincronização. Verifique sua conexão.";
  } finally {
    syncEmAndamento = false;
    renderPendencias(await carregarPendencias());
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

  btnSync.addEventListener("click", () => processarFilaSync());
});

// Expor para outros módulos se necessário
window.processarFilaSync = processarFilaSync;
