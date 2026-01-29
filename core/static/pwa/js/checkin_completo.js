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

  const limparErroCampo = (campo) => {
    campo?.classList.remove("pwa-input-error");
    campo?.removeAttribute("aria-invalid");
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
      label.setAttribute("for", `checkinPergunta${pergunta.id}`);
      label.textContent = pergunta.texto || "Pergunta";
      if (pergunta.obrigatoria) {
        const required = document.createElement("span");
        required.className = "pwa-required";
        required.textContent = " *";
        label.appendChild(required);
      }

      let input;
      if (pergunta.tipo_resposta === "ESCOLHA") {
        input = document.createElement("select");
        input.className = "pwa-select";
        input.innerHTML = `<option value="">Selecione uma opção</option>`;
        const opcoes = Array.isArray(pergunta.opcoes) ? pergunta.opcoes : [];
        opcoes
          .filter((op) => op.ativa !== false)
          .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
          .forEach((op) => {
            const option = document.createElement("option");
            option.value = op.id;
            option.textContent = op.texto;
            input.appendChild(option);
          });
      } else {
        input = document.createElement("textarea");
        input.className = "pwa-textarea";
        input.rows = 3;
      }

      input.id = `checkinPergunta${pergunta.id}`;
      input.dataset.perguntaId = pergunta.id;
      input.dataset.perguntaTexto = pergunta.texto || "";
      input.dataset.tipoResposta = pergunta.tipo_resposta || "TEXTO";
      input.dataset.obrigatoria = pergunta.obrigatoria ? "true" : "false";
      input.addEventListener("input", () => limparErroCampo(input));
      input.addEventListener("change", () => limparErroCampo(input));

      field.appendChild(label);
      field.appendChild(input);
      perguntasLista.appendChild(field);
    });
  };

  const montarRespostas = () => {
    return perguntasAtuais
      .map((pergunta) => {
        const campo = form.querySelector(`[data-pergunta-id="${pergunta.id}"]`);
        if (!campo) return null;
        const valor = campo.value?.trim();
        if (!valor) return null;

        if (pergunta.tipo_resposta === "ESCOLHA") {
          const opcoes = Array.isArray(pergunta.opcoes) ? pergunta.opcoes : [];
          const opcaoSelecionada = opcoes.find(
            (op) => String(op.id) === String(valor)
          );
          return {
            pergunta_id: pergunta.id,
            texto_pergunta: pergunta.texto,
            tipo_resposta: pergunta.tipo_resposta,
            resposta: opcaoSelecionada?.texto || valor,
            opcao_id: opcaoSelecionada?.id || null,
          };
        }

        return {
          pergunta_id: pergunta.id,
          texto_pergunta: pergunta.texto,
          tipo_resposta: pergunta.tipo_resposta,
          resposta: valor,
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
        const campo = form.querySelector(`[data-pergunta-id="${pergunta.id}"]`);
        if (!campo || !campo.value.trim()) {
          marcarErroCampo(campo);
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
