// static/pwa/js/home.js
// Modal para seleção do tipo de check-in na Home

document.addEventListener("DOMContentLoaded", () => {
  const btnNovoCheckin = document.getElementById("btnNovoCheckin");
  const modal = document.getElementById("checkinTipoModal");
  const btnCancelar = document.getElementById("checkinModalCancelar");

  if (!btnNovoCheckin || !modal) return;

  const abrirModal = () => {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  };

  const fecharModal = () => {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  };

  btnNovoCheckin.addEventListener("click", abrirModal);
  btnCancelar?.addEventListener("click", fecharModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      fecharModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) {
      fecharModal();
    }
  });
});
