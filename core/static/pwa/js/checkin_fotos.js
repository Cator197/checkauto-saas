// static/pwa/js/checkin_fotos.js
// Tela de Check-in (Somente Fotos): salva OS rápida + fotos no IndexedDB

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("formCheckinFotos");
  const msgRetorno = document.getElementById("msgRetorno");

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const osRapida = {
      tipo: "so_fotos",
      criadoEm: new Date().toISOString(),
      pendenteSync: true,
      veiculo: {
        placa: document.getElementById("veiculoPlaca").value.trim(),
        modelo: document.getElementById("veiculoModelo").value.trim(),
      },
      os: {
        numeroInterno: document.getElementById("osNumero").value.trim(),
        observacoes: document.getElementById("observacoes").value.trim(),
      },
      fotos: {
        padrao: window.checkautoFotosPadrao || [],
        livres: window.checkautoFotosLivres || [],
      },
    };

    try {
      const ok = await window.checkautoSalvarOSPendente(osRapida);
      if (!ok) {
        throw new Error("Falha ao salvar OS rápida no IndexedDB");
      }

      msgRetorno.style.display = "block";
      msgRetorno.style.color = "green";
      msgRetorno.textContent = "Check-in rápido salvo localmente como pendência de sincronização.";

      form.reset();

      if (window.checkautoLimparFotos) {
        window.checkautoLimparFotos();
      }

      console.log("OS pendente (só fotos) salva no IndexedDB:", osRapida);

      if (window.checkautoAtualizarContadoresHome) {
        window.checkautoAtualizarContadoresHome();
      }
    } catch (e) {
      console.error("Erro ao salvar OS pendente (só fotos):", e);
      msgRetorno.style.display = "block";
      msgRetorno.style.color = "red";
      msgRetorno.textContent = "Erro ao salvar check-in rápido offline.";
    }
  });
});
