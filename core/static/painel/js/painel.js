// ==== Helpers de autenticação para o painel ====

function redirectToLogin() {
    // limpa tokens e usuário e manda para a tela de login
    localStorage.removeItem("checkauto_access");
    localStorage.removeItem("checkauto_refresh");
    localStorage.removeItem("checkauto_user");
    window.location.href = "/painel/login/";
}

async function refreshAccessToken() {
    const refresh = localStorage.getItem("checkauto_refresh");
    if (!refresh) {
        redirectToLogin();
        return null;
    }

    try {
        const resp = await fetch("/api/refresh/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ refresh }),
        });

        if (!resp.ok) {
            redirectToLogin();
            return null;
        }

        const data = await resp.json();
        if (!data.access) {
            redirectToLogin();
            return null;
        }

        localStorage.setItem("checkauto_access", data.access);
        return data.access;
    } catch (e) {
        console.error("Erro ao renovar token:", e);
        redirectToLogin();
        return null;
    }
}

async function apiFetch(path, options = {}) {
    let access = localStorage.getItem("checkauto_access");
    if (!access) {
        redirectToLogin();
        return null;
    }

    const headers = Object.assign({}, options.headers || {}, {
        "Authorization": `Bearer ${access}`,
    });

    const init = Object.assign({}, options, { headers });

    // Sempre prefixamos com /api
    let resp = await fetch(`/api${path}`, init);

    // Se deu 401, tentamos renovar o token e refazer a requisição
    if (resp.status === 401) {
        access = await refreshAccessToken();
        if (!access) {
            return null;
        }

        const retryHeaders = Object.assign({}, options.headers || {}, {
            "Authorization": `Bearer ${access}`,
        });

        resp = await fetch(`/api${path}`, Object.assign({}, options, { headers: retryHeaders }));
    }

    return resp;
}

// ==== Lógica específica do painel / dashboard ====

async function carregarDashboardResumo() {
    try {
        const resp = await apiFetch("/dashboard-resumo/");
        if (!resp) {
            console.error("Resposta vazia ao buscar dashboard-resumo");
            return;
        }

        if (!resp.ok) {
            const txt = await resp.text();
            console.error("Erro ao buscar dashboard-resumo:", resp.status, txt);
            return;
        }

        const data = await resp.json();
        console.log("Resumo do dashboard:", data);

        // Atualiza cards se existirem no HTML
        const elOsAbertas = document.getElementById("card-os-abertas");
        if (elOsAbertas) {
            elOsAbertas.textContent = data.os_abertas ?? 0;
        }

        const elCheckinsHoje = document.getElementById("card-checkins-hoje");
        if (elCheckinsHoje) {
            elCheckinsHoje.textContent = data.checkins_hoje ?? 0;
        }

        // Se você tiver uma área de etapas, pode tratar aqui futuramente:
        // data.etapas é um array com {id, nome, total_os}
        // por enquanto deixo só logado no console
    } catch (err) {
        console.error("Erro ao buscar dashboard-resumo:", err);
    }
}

// ==== Código original de sidebar + menu ativo ====

document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const btnToggleSidebar = document.getElementById("btnToggleSidebar");
    const menuLinks = document.querySelectorAll(".menu-link");

    // Abrir/fechar sidebar no mobile
    if (btnToggleSidebar && sidebar) {
        btnToggleSidebar.addEventListener("click", () => {
            // Em mobile, mostramos a sidebar como overlay simples
            if (sidebar.classList.contains("hidden")) {
                sidebar.classList.remove("hidden");
                sidebar.classList.add("fixed", "z-30", "inset-y-0");
            } else {
                sidebar.classList.add("hidden");
                sidebar.classList.remove("fixed", "z-30", "inset-y-0");
            }
        });
    }

    // Destacar link ativo (por enquanto só pelo pathname simples)
    const path = window.location.pathname;

    menuLinks.forEach(link => {
        const menu = link.getAttribute("data-menu");

        // por enquanto vamos só marcar o dashboard quando estiver em /painel/
        if (menu === "dashboard" && path.startsWith("/painel")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }

        // no futuro podemos checar outras rotas:
        if (menu === "os" && path.startsWith("/painel/os")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }

        if (menu === "etapas" && path.startsWith("/painel/etapas")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }
        if (menu === "fotos" && path.startsWith("/painel/fotos")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }
        if (menu === "usuarios" && path.startsWith("/painel/usuarios")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }
    });

    // Só carrega o resumo do dashboard na tela principal do painel
    if (path === "/painel/" || path === "/painel") {
        carregarDashboardResumo();
    }
});
