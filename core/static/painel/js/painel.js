// ==== Lógica específica do painel / dashboard ====
// IMPORTANTE:
// Este arquivo NÃO deve conter helpers de auth/apiFetch.
// Os helpers oficiais estão em:
// - /static/painel/js/api.js  (apiFetch + refresh/retry)
// - /static/painel/js/auth.js (verificarAutenticacao + logout/redirect)
//
// Isso evita duplicação e o bug de /api/api/*.

async function carregarDashboardResumo() {
    try {
        // apiFetch deve vir do api.js (não redefinir aqui)
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

        // Etapas em destaque (se você for implementar depois)
        // data.etapas => array com {id, nome, total_os}
    } catch (err) {
        console.error("Erro ao buscar dashboard-resumo:", err);
    }
}

// ==== Código original de sidebar + menu ativo ====

document.addEventListener("DOMContentLoaded", async () => {
    // 1) Verificar autenticação (auth.js)
    // Se não estiver logado, auth.js deve redirecionar e retornamos.
    if (typeof verificarAutenticacao === "function") {
        const ok = await verificarAutenticacao();
        if (!ok) return;
    } else {
        console.warn("verificarAutenticacao() não encontrado. Verifique se auth.js foi carregado antes de painel.js.");
        // Se não tiver o helper, ainda tentamos seguir (mas pode falhar)
    }

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

    // Destacar link ativo
    const path = window.location.pathname;

    menuLinks.forEach(link => {
        const menu = link.getAttribute("data-menu");

        // Dashboard
        if (menu === "dashboard" && (path === "/painel/" || path === "/painel")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }

        // OS
        if (menu === "os" && path.startsWith("/painel/os")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }

        // Etapas
        if (menu === "etapas" && path.startsWith("/painel/etapas")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }

        // Configurar fotos (ajuste para sua rota real; antes estava /painel/fotos)
        if (menu === "fotos" && (path.startsWith("/painel/fotos") || path.startsWith("/painel/config-fotos") || path.startsWith("/painel/config_fotos"))) {
            link.classList.add("bg-slate-800/90", "text-white");
        }

        // Usuários
        if (menu === "usuarios" && path.startsWith("/painel/usuarios")) {
            link.classList.add("bg-slate-800/90", "text-white");
        }
    });

    // Só carrega o resumo do dashboard na tela principal do painel
    if (path === "/painel/" || path === "/painel") {
        await carregarDashboardResumo();
    }
});
