document.addEventListener("DOMContentLoaded", async () => {
    const erroBox = document.getElementById("checkin-erro");
    const defaultErroMensagem = erroBox?.textContent?.trim() || "";

    const ok = await verificarAutenticacao();
    if (!ok) return;

    const tbody = document.getElementById("checkin-tbody");
    const countLabel = document.getElementById("checkin-count");

    const modal = document.getElementById("checkin-modal");
    const modalTitle = document.getElementById("checkin-modal-title");
    const btnNovaPergunta = document.getElementById("btn-nova-pergunta");
    const btnFecharModal = document.getElementById("btn-fechar-modal");
    const btnCancelarModal = document.getElementById("btn-cancelar-modal");

    const form = document.getElementById("form-checkin-pergunta");
    const inputId = document.getElementById("checkin-id");
    const inputTexto = document.getElementById("checkin-texto");
    const inputOrdem = document.getElementById("checkin-ordem");
    const inputObrigatoria = document.getElementById("checkin-obrigatoria");
    const inputAtiva = document.getElementById("checkin-ativa");
    const inputPermiteTexto = document.getElementById("checkin-permite-texto");

    function abrirModal() {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }

    function fecharModal() {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }

    function limparFormulario() {
        inputId.value = "";
        inputTexto.value = "";
        inputOrdem.value = "";
        inputObrigatoria.checked = true;
        inputAtiva.checked = true;
        inputPermiteTexto.checked = false;
    }

    function mostrarErro(mensagem) {
        if (!erroBox) return;
        erroBox.textContent = mensagem || defaultErroMensagem;
        erroBox.classList.remove("hidden");
    }

    function esconderErro() {
        if (!erroBox) return;
        erroBox.textContent = defaultErroMensagem;
        erroBox.classList.add("hidden");
    }

    function carregarPerguntas() {
        tbody.innerHTML = "";

        apiFetch("/api/checkin-perguntas/", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        })
        .then(async (resp) => {
            if (!resp.ok) {
                const t = await resp.text();
                console.error("Erro ao listar perguntas:", resp.status, t);
                mostrarErro("Erro ao carregar as perguntas de check-in. Tente novamente em instantes.");
                return null;
            }
            return resp.json();
        })
        .then((data) => {
            if (!data) return;

            let lista = data;
            if (Array.isArray(data.results)) {
                lista = data.results;
            }

            tbody.innerHTML = "";

            if (!lista || !lista.length) {
                countLabel.textContent = "Nenhuma pergunta configurada.";
                esconderErro();
                return;
            }

            countLabel.textContent = `${lista.length} pergunta${lista.length > 1 ? "s" : ""}`;
            lista.forEach(pergunta => adicionarLinha(pergunta));
            esconderErro();
        })
        .catch((err) => {
            console.error("Erro inesperado ao listar perguntas:", err);
            mostrarErro("Erro inesperado ao carregar perguntas. Verifique sua conexão e tente novamente.");
        });
    }

    function adicionarLinha(pergunta) {
        const tr = document.createElement("tr");
        tr.dataset.id = pergunta.id;
        tr.className = "hover:bg-slate-900";

        const marcarSimNao = (valor) => (valor ? "Sim" : "Não");

        tr.innerHTML = `
            <td class="px-3 py-2 align-middle whitespace-nowrap">
                ${pergunta.ordem ?? ""}
            </td>
            <td class="px-3 py-2 align-middle whitespace-nowrap">
                ${pergunta.texto ?? ""}
            </td>
            <td class="px-3 py-2 align-middle whitespace-nowrap">
                <span class="inline-flex items-center gap-1 text-[11px]">
                    <span class="w-2 h-2 rounded-full ${pergunta.obrigatoria ? "bg-amber-400" : "bg-slate-600"}"></span>
                    ${marcarSimNao(pergunta.obrigatoria)}
                </span>
            </td>
            <td class="px-3 py-2 align-middle whitespace-nowrap">
                <span class="inline-flex items-center gap-1 text-[11px]">
                    <span class="w-2 h-2 rounded-full ${pergunta.ativa ? "bg-emerald-400" : "bg-rose-400"}"></span>
                    ${marcarSimNao(pergunta.ativa)}
                </span>
            </td>
            <td class="px-3 py-2 align-middle whitespace-nowrap">
                <span class="inline-flex items-center gap-1 text-[11px]">
                    <span class="w-2 h-2 rounded-full ${pergunta.permite_texto ? "bg-indigo-400" : "bg-slate-600"}"></span>
                    ${marcarSimNao(pergunta.permite_texto)}
                </span>
            </td>
            <td class="px-3 py-2 align-middle whitespace-nowrap text-right">
                <button
                    type="button"
                    class="btn-checkin-editar inline-flex items-center px-3 py-1 rounded-lg border border-slate-700
                           text-[11px] text-slate-100 hover:bg-slate-800/80 mr-1">
                    Editar
                </button>
                <button
                    type="button"
                    class="btn-checkin-toggle inline-flex items-center px-3 py-1 rounded-lg border border-slate-700
                           text-[11px] text-slate-100 hover:bg-slate-800/80">
                    ${pergunta.ativa ? "Desativar" : "Ativar"}
                </button>
            </td>
        `;

        tr.querySelector(".btn-checkin-editar").addEventListener("click", () => {
            preencherFormulario(pergunta);
            abrirModal();
        });

        tr.querySelector(".btn-checkin-toggle").addEventListener("click", () => {
            alternarAtivacao(pergunta);
        });

        tbody.appendChild(tr);
    }

    function preencherFormulario(pergunta) {
        inputId.value = pergunta.id;
        inputTexto.value = pergunta.texto ?? "";
        inputOrdem.value = pergunta.ordem ?? "";
        inputObrigatoria.checked = !!pergunta.obrigatoria;
        inputAtiva.checked = !!pergunta.ativa;
        inputPermiteTexto.checked = !!pergunta.permite_texto;
        modalTitle.textContent = "Editar pergunta";
    }

    function alternarAtivacao(pergunta) {
        apiFetch(`/api/checkin-perguntas/${pergunta.id}/`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: {
                ativa: !pergunta.ativa,
            },
        })
        .then(async (resp) => {
            if (!resp.ok) {
                const t = await resp.text();
                console.error("Erro ao alterar status da pergunta:", resp.status, t);
                mostrarErro("Erro ao atualizar o status da pergunta. Tente novamente.");
                return null;
            }
            return resp.json();
        })
        .then((data) => {
            if (!data) return;
            carregarPerguntas();
            esconderErro();
        })
        .catch((err) => {
            console.error("Erro inesperado ao alterar status:", err);
            mostrarErro("Erro inesperado ao atualizar a pergunta. Tente novamente.");
        });
    }

    btnNovaPergunta.addEventListener("click", () => {
        limparFormulario();
        modalTitle.textContent = "Nova pergunta";
        abrirModal();
    });

    btnFecharModal.addEventListener("click", fecharModal);
    btnCancelarModal.addEventListener("click", fecharModal);

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            fecharModal();
        }
    });

    form.addEventListener("submit", (e) => {
        e.preventDefault();

        const payload = {
            texto: inputTexto.value.trim(),
            obrigatoria: inputObrigatoria.checked,
            ativa: inputAtiva.checked,
            ordem: inputOrdem.value ? parseInt(inputOrdem.value, 10) : null,
            permite_texto: inputPermiteTexto.checked,
        };

        if (!payload.texto) {
            alert("Informe o texto da pergunta.");
            return;
        }

        const id = inputId.value;
        const isEdicao = Boolean(id);

        let url = "/api/checkin-perguntas/";
        let method = "POST";

        if (isEdicao) {
            url = `/api/checkin-perguntas/${id}/`;
            method = "PATCH";
        }

        apiFetch(url, {
            method: method,
            headers: {
                "Content-Type": "application/json",
            },
            body: payload,
        })
        .then(async (resp) => {
            if (!resp.ok) {
                const t = await resp.text();
                console.error("Erro ao salvar pergunta:", resp.status, t);
                mostrarErro("Erro ao salvar pergunta. Verifique os campos e tente novamente.");
                return null;
            }
            return resp.json();
        })
        .then((data) => {
            if (!data) return;
            fecharModal();
            limparFormulario();
            carregarPerguntas();
            esconderErro();
        })
        .catch((err) => {
            console.error("Erro inesperado ao salvar pergunta:", err);
            mostrarErro("Erro inesperado ao salvar pergunta. Tente novamente.");
        });
    });

    carregarPerguntas();
});
