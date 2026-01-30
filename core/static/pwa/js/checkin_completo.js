// static/pwa/js/checkin_completo.js
// Tela de Check-in Completo: salva OS + fotos + respostas no IndexedDB

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("formCheckinCompleto");
  const msgRetorno = document.getElementById("msgRetorno");
  const perguntasStatus = document.getElementById("checkinPerguntasStatus");
  const perguntasAviso = document.getElementById("checkinPerguntasAviso");
  const perguntasLista = document.getElementById("checkinPerguntasLista");
  const submitButton = form?.querySelector("button[type='submit']");

  if (!form) return;

  let perguntasAtuais = [];
  let perguntasDisponiveis = false;
  const STATUS_BOM = "BOM";
  const STATUS_RUIM = "RUIM";
  const STATUS_AUSENTE = "AUSENTE";

  const limparErroCampo = (campo) => {
    campo?.classList.remove("pwa-input-error");
    campo?.removeAttribute("aria-invalid");
  };

  const limparErroGrupoRadio = (nome) => {
    const inputs = form.querySelectorAll(`input[name="${nome}"]`);
    inputs.forEach((input) => limparErroCampo(input));
  };

  const marcarErroCampo = (campo) => {
    campo?.classList.add("pwa-input-error");
    campo?.setAttribute("aria-invalid", "true");
  };

  ["veiculoPlaca"].forEach((id) => {
    const campo = document.getElementById(id);
    campo?.addEventListener("input", () => limparErroCampo(campo));
  });

  const renderPerguntas = (perguntas) => {
    if (!perguntasLista) return;
    perguntasLista.innerHTML = "";

    perguntas.forEach((pergunta) => {
      const field = document.createElement("div");
      field.className = "pwa-field";

      const label = document.createElement("label");
      label.textContent = pergunta.texto || "Pergunta";
      if (pergunta.obrigatoria) {
        const required = document.createElement("span");
        required.className = "pwa-required";
        required.textContent = " *";
        label.appendChild(required);
      }

      field.appendChild(label);

      const opcoesWrapper = document.createElement("div");
      opcoesWrapper.className = "pwa-options";

      const opcoes = [
        { valor: STATUS_BOM, texto: "Bom" },
        { valor: STATUS_RUIM, texto: "Ruim" },
        { valor: STATUS_AUSENTE, texto: "Ausente" },
      ];

      opcoes.forEach((opcao) => {
        const opcaoLabel = document.createElement("label");
        opcaoLabel.className = "pwa-option";

        const opcaoInput = document.createElement("input");
        opcaoInput.type = "radio";
        opcaoInput.name = `pergunta-${pergunta.id}`;
        opcaoInput.value = opcao.valor;
        opcaoInput.dataset.perguntaId = pergunta.id;
        opcaoInput.addEventListener("change", () =>
          limparErroGrupoRadio(`pergunta-${pergunta.id}`)
        );

        const opcaoTexto = document.createElement("span");
        opcaoTexto.textContent = opcao.texto;

        opcaoLabel.appendChild(opcaoInput);
        opcaoLabel.appendChild(opcaoTexto);
        opcoesWrapper.appendChild(opcaoLabel);
      });

      field.appendChild(opcoesWrapper);

      if (pergunta.permite_texto) {
        const comentario = document.createElement("textarea");
        comentario.className = "pwa-textarea";
        comentario.rows = 3;
        comentario.id = `checkinPergunta${pergunta.id}Texto`;
        comentario.dataset.perguntaTexto = pergunta.texto || "";
        comentario.placeholder = "Comentário / observações";
        comentario.addEventListener("input", () => limparErroCampo(comentario));
        field.appendChild(comentario);
      }

      perguntasLista.appendChild(field);
    });
  };

  const montarRespostas = () => {
    return perguntasAtuais
      .map((pergunta) => {
        const selecionada = form.querySelector(
          `input[name="pergunta-${pergunta.id}"]:checked`
        );
        const status = selecionada?.value || "";
        const comentarioField = pergunta.permite_texto
          ? document.getElementById(`checkinPergunta${pergunta.id}Texto`)
          : null;
        const comentario = comentarioField?.value?.trim() || "";

        if (!status && !comentario) {
          return null;
        }

        return {
          pergunta_id: pergunta.id,
          texto_pergunta: pergunta.texto,
          status: status || null,
          comentario: comentario || null,
        };
      })
      .filter(Boolean);
  };

  const validarFormulario = () => {
    let valido = true;
    const camposObrigatorios = [
      {
        id: "veiculoPlaca",
        label: "Placa",
      },
    ];

    camposObrigatorios.forEach((campo) => {
      const input = document.getElementById(campo.id);
      if (!input || !input.value.trim()) {
        marcarErroCampo(input);
        valido = false;
      }
    });

    perguntasAtuais
      .filter((pergunta) => pergunta.obrigatoria)
      .forEach((pergunta) => {
        const selecionada = form.querySelector(
          `input[name="pergunta-${pergunta.id}"]:checked`
        );
        if (!selecionada) {
          const opcoes = form.querySelectorAll(
            `input[name="pergunta-${pergunta.id}"]`
          );
          opcoes.forEach((opcao) => marcarErroCampo(opcao));
          valido = false;
        }
      });

    return valido;
  };

  const atualizarStatusPerguntas = (texto, classe = "state-info") => {
    if (!perguntasStatus) return;
    perguntasStatus.className = classe;
    perguntasStatus.textContent = texto;
  };

  const carregarPerguntas = async () => {
    let data = null;
    let origem = "offline";
    let erroCarregamento = null;

    if (navigator.onLine) {
      try {
        const resp = await apiFetch("/api/checkin-perguntas/pwa/");
        if (resp.ok) {
          data = await resp.json();
          origem = "online";
        } else {
          erroCarregamento = `Falha ao buscar perguntas (${resp.status}).`;
        }
      } catch (err) {
        erroCarregamento = "Não foi possível conectar para carregar as perguntas.";
        console.warn("Falha ao buscar perguntas online:", err);
      }
    }

    if (!data && window.checkautoBuscarPerguntasCheckin) {
      data = await window.checkautoBuscarPerguntasCheckin();
      if (data) {
        origem = "cache";
      }
    }

    if (data && origem === "online" && window.checkautoSalvarPerguntasCheckin) {
      await window.checkautoSalvarPerguntasCheckin(data);
    }

    if (!data) {
      perguntasAtuais = [];
      perguntasDisponiveis = false;
      if (erroCarregamento) {
        atualizarStatusPerguntas(erroCarregamento, "state-error");
      } else {
        atualizarStatusPerguntas(
          "Perguntas de check-in não disponíveis offline.",
          "state-offline"
        );
      }
      if (perguntasAviso) {
        perguntasAviso.style.display = "block";
        perguntasAviso.innerHTML =
          'Use o check-in básico enquanto não há conexão ou cache disponível. <a href="/pwa/checkin-fotos/">Abrir check-in básico</a>.';
      }
      if (submitButton) {
        submitButton.disabled = true;
      }
      return;
    }

    if (perguntasAviso) {
      perguntasAviso.style.display = "none";
      perguntasAviso.textContent = "";
    }
    if (submitButton) {
      submitButton.disabled = false;
    }

    const listaPerguntas = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : [];

    const perguntasFiltradas = listaPerguntas.filter((item) => item.ativa !== false);

    perguntasAtuais = perguntasFiltradas;
    perguntasDisponiveis = true;

    if (!perguntasFiltradas.length) {
      atualizarStatusPerguntas(
        "Nenhuma pergunta configurada para a entrada. Você pode continuar o check-in normalmente.",
        "state-info"
      );
    } else {
      atualizarStatusPerguntas(
        origem === "cache"
          ? "Perguntas carregadas do cache offline."
          : "Perguntas carregadas com sucesso.",
        "state-info"
      );
      renderPerguntas(perguntasFiltradas);
    }
  };

  carregarPerguntas();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!perguntasDisponiveis) {
      msgRetorno.style.display = "block";
      msgRetorno.style.color = "red";
      msgRetorno.textContent =
        "Perguntas indisponíveis no momento. Use o check-in básico.";
      return;
    }

    if (!validarFormulario()) {
      msgRetorno.style.display = "block";
      msgRetorno.style.color = "red";
      msgRetorno.textContent =
        "Preencha os campos obrigatórios antes de salvar o check-in.";
      return;
    }

    const osObj = {
      tipo: "completo",
      tipo_checkin: "COMPLETO",
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
      checkin_respostas: montarRespostas(),
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

      msgRetorno.style.display = "block";
      msgRetorno.style.color = "green";
      msgRetorno.textContent = "Check-in salvo localmente como pendente de sincronização.";

      form.reset();

      if (window.checkautoLimparFotos) {
        window.checkautoLimparFotos();
      }

      renderPerguntas(perguntasAtuais);

      console.log("OS pendente (completo) salva no IndexedDB:", osObj);

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
