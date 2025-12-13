// static/pwa/js/sync.js
// Lógica da tela de sincronização do PWA

document.addEventListener("DOMContentLoaded", async () => {
  const btnSync = document.getElementById("btnSync");
  const statusBox = document.getElementById("syncStatus");
  const listaDiv = document.getElementById("listaPendentes");
  const spanQtd = document.getElementById("qtdPendentes");

  async function carregarPendencias() {
    const pendentes = await window.checkautoBuscarOSPendentes();
    spanQtd.textContent = pendentes.length.toString();

    listaDiv.innerHTML = "";

    if (pendentes.length === 0) {
      listaDiv.innerHTML = "<p>Nenhuma OS pendente encontrada.</p>";
      return pendentes;
    }

    pendentes.forEach((os) => {
      const div = document.createElement("div");
      div.className = "os-item";
      div.innerHTML = `
        <strong>ID Offline:</strong> ${os.id}<br>
        <strong>Placa:</strong> ${os.veiculo?.placa || "-"}<br>
        <strong>Tipo:</strong> ${os.tipo}<br>
        <strong>Criado em:</strong> ${new Date(os.criadoEm).toLocaleString()}
      `;
      listaDiv.appendChild(div);
    });

    return pendentes;
  }

  // Renderiza as pendências ao entrar na tela
  let pendenciasAtuais = await carregarPendencias();

  btnSync.addEventListener("click", async () => {
    statusBox.innerHTML = "⏳ Preparando sincronização…";

    if (!navigator.onLine) {
      statusBox.innerHTML = "❌ Sem internet. Conecte-se e tente novamente.";
      return;
    }

    if (pendenciasAtuais.length === 0) {
      statusBox.innerHTML = "Nenhuma OS pendente para sincronizar.";
      return;
    }

    try {
      statusBox.innerHTML = "📤 Enviando dados para o servidor…";

      // 🔴 IMPORTANTE: pegar o token salvo e mandar no header
      const token = localStorage.getItem("checkauto_token");
      console.log("Token usado na sincronização:", token); // debug

      if (!token) {
        statusBox.innerHTML = "❌ Você precisa estar logado para sincronizar (token não encontrado).";
        return;
      }

      const response = await fetch("/api/sync/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          osPendentes: pendenciasAtuais,
        }),
      });

      if (!response.ok) {
        statusBox.innerHTML = "❌ Erro no servidor ao sincronizar.";
        console.log("Status da resposta /api/sync/:", response.status, response.statusText);
        return;
      }

      const data = await response.json();
      console.log("Resposta da API:", data);

      // Remover OS enviadas do IndexedDB
      const db = await window.checkautoOpenDB();
      await new Promise((resolve) => {
        const tx = db.transaction("osPendentes", "readwrite");
        const store = tx.objectStore("osPendentes");

        pendenciasAtuais.forEach((item) => store.delete(item.id));

        tx.oncomplete = resolve;
      });

      statusBox.innerHTML = "✅ Sincronização concluída com sucesso!";
      pendenciasAtuais = await carregarPendencias();

      if (window.checkautoAtualizarContadoresHome) {
        window.checkautoAtualizarContadoresHome();
      }

    } catch (err) {
      console.error("Erro na sincronização:", err);
      statusBox.innerHTML = "❌ Falha na sincronização. Verifique sua conexão.";
    }
  });
});
