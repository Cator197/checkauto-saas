// static/pwa/js/db.js
// Módulo central de IndexedDB para o PWA CheckAuto

const CHECKAUTO_DB_NAME = "checkauto_pwa";
const CHECKAUTO_DB_VERSION = 3;
const OS_STORE_NAME = "osPendentes";
const VEICULOS_PRODUCAO_STORE = "veiculosEmProducao";
const OS_PRODUCAO_STORE = "osProducao";

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
        const pendentes = todos.filter(
          (item) => item?.pendente_sync || item?.avancar_solicitado
        );
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
