// static/pwa/js/db.js
// Módulo central de IndexedDB para o PWA CheckAuto

const CHECKAUTO_DB_NAME = "checkauto_pwa";
const CHECKAUTO_DB_VERSION = 4;
const OS_STORE_NAME = "osPendentes";
const VEICULOS_PRODUCAO_STORE = "veiculosEmProducao";
const OS_PRODUCAO_STORE = "osProducao";
const SYNC_QUEUE_STORE = "filaSync";

// Abre (ou cria) o banco de dados
function checkautoOpenDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      console.error("IndexedDB não é suportado neste navegador.");
      reject(new Error("IndexedDB não suportado"));
      return;
    }

    const request = indexedDB.open(CHECKAUTO_DB_NAME, CHECKAUTO_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(OS_STORE_NAME)) {
        db.createObjectStore(OS_STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }

      if (!db.objectStoreNames.contains(VEICULOS_PRODUCAO_STORE)) {
        db.createObjectStore(VEICULOS_PRODUCAO_STORE, {
          keyPath: "os_id",
        });
      }

      if (!db.objectStoreNames.contains(OS_PRODUCAO_STORE)) {
        db.createObjectStore(OS_PRODUCAO_STORE, {
          keyPath: "os_id",
        });
      }

      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        db.createObjectStore(SYNC_QUEUE_STORE, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      resolve(db);
    };

    request.onerror = () => {
      console.error("Erro ao abrir IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

// Salva uma OS pendente (completo ou só fotos)
window.checkautoSalvarOSPendente = async function (osObj) {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS_STORE_NAME, "readwrite");
      const store = tx.objectStore(OS_STORE_NAME);
      const request = store.add(osObj);

      tx.oncomplete = () => {
        resolve(true);
      };

      tx.onerror = () => {
        console.error("Erro ao salvar OS pendente no IndexedDB:", tx.error);
        reject(tx.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoSalvarOSPendente:", e);
    return false;
  }
};

// Busca todas as OS pendentes
window.checkautoBuscarOSPendentes = async function () {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS_STORE_NAME, "readonly");
      const store = tx.objectStore(OS_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error("Erro ao buscar OS pendentes no IndexedDB:", request.error);
        reject(request.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoBuscarOSPendentes:", e);
    return [];
  }
};

function normalizarItemFila(item) {
  return {
    id: item.id || `sync-${Date.now()}-${Math.random()}`,
    type: item.type,
    os_id: item.os_id,
    payload: item.payload || {},
    created_at: item.created_at || new Date().toISOString(),
    tries: typeof item.tries === "number" ? item.tries : 0,
    last_error: item.last_error || null,
  };
}

// Adiciona ou sobrescreve um item na fila de sincronização
window.checkautoAdicionarFilaSync = async function (item) {
  try {
    const normalizado = normalizarItemFila(item);
    const db = await checkautoOpenDB();

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      store.put(normalizado);

      tx.oncomplete = () => resolve(normalizado);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Falha em checkautoAdicionarFilaSync:", e);
    return null;
  }
};

// Lista todos os itens da fila (mais antigos primeiro)
window.checkautoListarFilaSync = async function () {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, "readonly");
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const itens = request.result || [];
        itens.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        resolve(itens);
      };

      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Falha em checkautoListarFilaSync:", e);
    return [];
  }
};

// Atualiza um item da fila
window.checkautoAtualizarItemFilaSync = async function (id, patch) {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        const atual = request.result;
        if (!atual) {
          resolve(null);
          return;
        }

        const atualizado = { ...atual, ...patch };
        store.put(atualizado);
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Falha em checkautoAtualizarItemFilaSync:", e);
    return null;
  }
};

window.checkautoRegistrarErroFilaSync = async function (id, mensagem) {
  const item = (await window.checkautoListarFilaSync()).find((i) => i.id === id);
  if (!item) return null;

  return window.checkautoAdicionarFilaSync({
    ...item,
    tries: (item.tries || 0) + 1,
    last_error: mensagem || "Erro desconhecido",
  });
};

// Remove um item da fila
window.checkautoRemoverItemFilaSync = async function (id) {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(SYNC_QUEUE_STORE);
      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("Falha em checkautoRemoverItemFilaSync:", e);
    return false;
  }
};

// Remove itens que correspondem a um predicado simples
window.checkautoRemoverDaFilaPorFiltro = async function (filterFn) {
  const itens = await window.checkautoListarFilaSync();
  const alvo = itens.filter((item) => filterFn(item));
  await Promise.all(alvo.map((item) => window.checkautoRemoverItemFilaSync(item.id)));
};

// Salva a lista de veículos em produção (sobrescreve o store)
window.checkautoSalvarVeiculosEmProducao = async function (lista) {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VEICULOS_PRODUCAO_STORE, "readwrite");
      const store = tx.objectStore(VEICULOS_PRODUCAO_STORE);

      store.clear();
      (lista || []).forEach((item) => store.put(item));

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.error("Erro ao salvar veículos em produção:", tx.error);
        reject(tx.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoSalvarVeiculosEmProducao:", e);
    return false;
  }
};

// Busca a lista de veículos em produção
window.checkautoBuscarVeiculosEmProducao = async function () {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VEICULOS_PRODUCAO_STORE, "readonly");
      const store = tx.objectStore(VEICULOS_PRODUCAO_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error("Erro ao buscar veículos em produção:", request.error);
        reject(request.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoBuscarVeiculosEmProducao:", e);
    return [];
  }
};

// Salva/atualiza dados da tela de produção da OS
window.checkautoSalvarOSProducao = async function (dados) {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS_PRODUCAO_STORE, "readwrite");
      const store = tx.objectStore(OS_PRODUCAO_STORE);
      store.put(dados);

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.error("Erro ao salvar produção da OS:", tx.error);
        reject(tx.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoSalvarOSProducao:", e);
    return false;
  }
};

async function checkautoUpsertOSProducao(osId, transformFn) {
  const atual = (await window.checkautoBuscarOSProducao(osId)) || { os_id: osId };
  const atualizado = transformFn ? transformFn({ ...atual, os_id: osId }) : atual;

  await window.checkautoSalvarOSProducao(atualizado);
  return atualizado;
}

// Busca dados salvos da produção da OS
window.checkautoBuscarOSProducao = async function (osId) {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS_PRODUCAO_STORE, "readonly");
      const store = tx.objectStore(OS_PRODUCAO_STORE);
      const request = store.get(osId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => {
        console.error("Erro ao buscar produção da OS:", request.error);
        reject(request.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoBuscarOSProducao:", e);
    return null;
  }
};

window.checkautoRemoverOperacaoProducao = async function (osId, operacaoId) {
  return checkautoUpsertOSProducao(osId, (item) => {
    const filaAtual = Array.isArray(item.fila_sync) ? item.fila_sync : [];
    const novaFila = filaAtual.filter((op) => op.id !== operacaoId);

    return {
      ...item,
      fila_sync: novaFila,
      pendente_sync: item.pendente_sync || item.avancar_solicitado || novaFila.length > 0,
    };
  });
};

window.checkautoEnfileirarPatchOS = async function (osId, payload, extra = {}) {
  const operacao = await window.checkautoAdicionarFilaSync({
    id: `patch-${Date.now()}-${Math.random()}`,
    type: "PATCH_OS",
    os_id: osId,
    payload,
  });

  return checkautoUpsertOSProducao(osId, (item) => {
    const filaAtual = Array.isArray(item.fila_sync) ? item.fila_sync : [];

    return {
      ...item,
      ...extra,
      fila_sync: [...filaAtual.filter((op) => op.id !== operacao.id), operacao],
      pendente_sync: true,
    };
  });
};

window.checkautoEnfileirarFotoOS = async function (osId, payload, extra = {}) {
  const operacao = await window.checkautoAdicionarFilaSync({
    id: `foto-${Date.now()}-${Math.random()}`,
    type: "POST_FOTO_OS",
    os_id: osId,
    payload,
  });

  return checkautoUpsertOSProducao(osId, (item) => {
    const filaAtual = Array.isArray(item.fila_sync) ? item.fila_sync : [];
    const novaFila = [...filaAtual.filter((op) => op.id !== operacao.id), operacao];

    return {
      ...item,
      ...extra,
      fila_sync: novaFila,
      pendente_sync: true,
    };
  });
};

window.checkautoEnfileirarObservacaoOS = async function (osId, payload, extra = {}) {
  await window.checkautoRemoverDaFilaPorFiltro(
    (item) => item.type === "UPSERT_OBSERVACAO" && item.os_id === osId
  );

  const operacao = await window.checkautoAdicionarFilaSync({
    id: `obs-${Date.now()}-${Math.random()}`,
    type: "UPSERT_OBSERVACAO",
    os_id: osId,
    payload,
  });

  return checkautoUpsertOSProducao(osId, (item) => {
    const filaAtual = Array.isArray(item.fila_sync) ? item.fila_sync : [];
    const semAntigas = filaAtual.filter((op) => op.type !== "UPSERT_OBSERVACAO");

    return {
      ...item,
      ...extra,
      fila_sync: [...semAntigas, operacao],
      pendente_sync: true,
    };
  });
};

// Lista OS com pendências de produção (observação, fotos, avanço de etapa)
window.checkautoListarOSProducaoPendentes = async function () {
  try {
    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS_PRODUCAO_STORE, "readonly");
      const store = tx.objectStore(OS_PRODUCAO_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const todos = request.result || [];
        const pendentes = todos.filter((item) => {
          const fila = Array.isArray(item?.fila_sync) ? item.fila_sync : [];
          return item?.pendente_sync || item?.avancar_solicitado || fila.length > 0;
        });
        resolve(pendentes);
      };

      request.onerror = () => {
        console.error("Erro ao listar produção pendente:", request.error);
        reject(request.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoListarOSProducaoPendentes:", e);
    return [];
  }
};

// Marca uma OS de produção como sincronizada (mantém dados locais)
window.checkautoMarcarOSProducaoSincronizada = async function (osId) {
  try {
    const atual = await window.checkautoBuscarOSProducao(osId);
    if (!atual) return false;

    atual.pendente_sync = false;
    atual.avancar_solicitado = false;
    atual.fila_sync = [];
    atual.ultima_sincronizacao = new Date().toISOString();

    const db = await checkautoOpenDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS_PRODUCAO_STORE, "readwrite");
      const store = tx.objectStore(OS_PRODUCAO_STORE);
      store.put(atual);

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.error("Erro ao marcar produção sincronizada:", tx.error);
        reject(tx.error);
      };
    });
  } catch (e) {
    console.error("Falha em checkautoMarcarOSProducaoSincronizada:", e);
    return false;
  }
};
