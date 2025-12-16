// static/pwa/js/db.js
// Módulo central de IndexedDB para o PWA CheckAuto

const CHECKAUTO_DB_NAME = "checkauto_pwa";
const CHECKAUTO_DB_VERSION = 2;
const OS_STORE_NAME = "osPendentes";
const VEICULOS_PRODUCAO_STORE = "veiculosEmProducao";

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
