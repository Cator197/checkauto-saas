// static/pwa/js/fotos_module.js

// Arrays globais (por tela) para armazenar as fotos selecionadas
let fotosPadrao = [];
let fotosLivres = [];
let fotoIdCounter = 1;

function gerarLocalId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16;
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return Math.floor(value).toString(16);
  });
}

// Expor para outros scripts (checkins)
window.checkautoFotosPadrao = fotosPadrao;
window.checkautoFotosLivres = fotosLivres;

// Função para limpar tudo (usada depois do submit)
window.checkautoLimparFotos = function () {
  fotosPadrao = [];
  fotosLivres = [];
  window.checkautoFotosPadrao = fotosPadrao;
  window.checkautoFotosLivres = fotosLivres;

  const listaPadrao = document.getElementById("listaFotosPadrao");
  const listaLivres = document.getElementById("listaFotosLivres");
  if (listaPadrao) listaPadrao.innerHTML = "";
  if (listaLivres) listaLivres.innerHTML = "";
};

// Cria um card de thumbnail visual
function criarThumbFoto(container, fotoObj, tipoLista) {
  const div = document.createElement("div");
  div.className = "foto-thumb";
  div.dataset.idFoto = fotoObj.id;
  div.dataset.tipoLista = tipoLista;

  const img = document.createElement("img");
  img.src = fotoObj.dataUrl;

  const btnX = document.createElement("button");
  btnX.type = "button";
  btnX.textContent = "X";

  btnX.addEventListener("click", () => {
    // Remove do array correspondente
    if (tipoLista === "padrao") {
      fotosPadrao = fotosPadrao.filter(f => f.id !== fotoObj.id);
      window.checkautoFotosPadrao = fotosPadrao;
    } else {
      fotosLivres = fotosLivres.filter(f => f.id !== fotoObj.id);
      window.checkautoFotosLivres = fotosLivres;
    }
    // Remove do DOM
    div.remove();
  });

  div.appendChild(img);
  div.appendChild(btnX);
  container.appendChild(div);
}

// Lida com seleção de arquivo (padrão ou livre)
function handleFileSelection(input, tipoLista) {
  const files = input.files;
  if (!files || !files.length) return;

  const containerId = tipoLista === "padrao" ? "listaFotosPadrao" : "listaFotosLivres";
  const container = document.getElementById(containerId);
  if (!container) return;

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;

      const fotoObj = {
        id: fotoIdCounter++,
        local_id: gerarLocalId(),
        nome: file.name,
        tipo: tipoLista === "padrao" ? "PADRAO" : "LIVRE",
        dataUrl: dataUrl,
        tamanhoBytes: file.size,
        criadoEm: new Date().toISOString(),
        etapa_id: null,
        config_foto_id: null,
        status_sync: "pending",
      };

      if (tipoLista === "padrao") {
        fotosPadrao.push(fotoObj);
        window.checkautoFotosPadrao = fotosPadrao;
      } else {
        fotosLivres.push(fotoObj);
        window.checkautoFotosLivres = fotosLivres;
      }

      criarThumbFoto(container, fotoObj, tipoLista);
    };
    reader.readAsDataURL(file);
  });

  // Permitir escolher de novo o mesmo arquivo se quiser
  input.value = "";
}

// Inicializa eventos dos botões/inputs de foto, se existirem na página
document.addEventListener("DOMContentLoaded", () => {
  const btnPadrao = document.getElementById("btnAddFotoPadrao");
  const inputPadrao = document.getElementById("inputFotoPadrao");
  const btnLivre = document.getElementById("btnAddFotoLivre");
  const inputLivre = document.getElementById("inputFotoLivre");

  if (btnPadrao && inputPadrao) {
    btnPadrao.addEventListener("click", () => inputPadrao.click());
    inputPadrao.addEventListener("change", () => handleFileSelection(inputPadrao, "padrao"));
  }

  if (btnLivre && inputLivre) {
    btnLivre.addEventListener("click", () => inputLivre.click());
    inputLivre.addEventListener("change", () => handleFileSelection(inputLivre, "livre"));
  }

  // Garante que, se o usuário voltar para a tela, comece sempre "limpo"
  window.checkautoLimparFotos();
});
