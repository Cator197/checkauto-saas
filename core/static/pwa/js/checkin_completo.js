// static/pwa/js/checkin_completo.js
// Tela de Check-in Completo: salva OS + fotos no IndexedDB

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("formCheckinCompleto");
  const msgRetorno = document.getElementById("msgRetorno");

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const osObj = {
      tipo: "completo",
      criadoEm: new Date().toISOString(),
      pendenteSync: true,
      cliente: {
        nome: document.getElementById("clienteNome").value.trim(),
        telefone: document.getElementById("clienteTelefone").value.trim(),
        email: document.getElementById("clienteEmail").value.trim(),
      },
      veiculo: {
        placa: document.getElementById("veiculoPlaca").value.trim(),
        modelo: document.getElementById("veiculoModelo").value.trim(),
        cor: document.getElementById("veiculoCor").value.trim(),
        ano: document.getElementById("veiculoAno").value,
        km: document.getElementById("veiculoKm").value,
      },
      os: {
        numeroInterno: document.getElementById("osNumero").value.trim(),
        etapaInicial: document.getElementById("etapaInicial").value,
        observacoes: document.getElementById("observacoes").value.trim(),
      },
      fotos: {
        padrao: window.checkautoFotosPadrao || [],
        livres: window.checkautoFotosLivres || [],
      },
    };

    try {
      const ok = await window.checkautoSalvarOSPendente(osObj);
      if (!ok) {
        throw new Error("Falha ao salvar OS no IndexedDB");
      }

      // Feedback visual
      msgRetorno.style.display = "block";
      msgRetorno.style.color = "green";
      msgRetorno.textContent = "Check-in salvo localmente como pendente de sincronização.";

      // Limpa o formulário
      form.reset();

      // Limpa fotos da tela
      if (window.checkautoLimparFotos) {
        window.checkautoLimparFotos();
      }

      console.log("OS pendente (completo) salva no IndexedDB:", osObj);

      // Atualiza contador na Home (para futuras SPAs / reuso)
      if (window.checkautoAtualizarContadoresHome) {
        window.checkautoAtualizarContadoresHome();
      }
    } catch (e) {
      console.error("Erro ao salvar OS pendente (completo):", e);
      msgRetorno.style.display = "block";
      msgRetorno.style.color = "red";
      msgRetorno.textContent = "Erro ao salvar check-in offline.";
    }
  });
});
