const ME_CACHE_KEY = "checkauto_me_cache";
const ME_CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedMe() {
    try {
        const raw = localStorage.getItem(ME_CACHE_KEY);
        if (!raw) {
            return null;
        }
        const data = JSON.parse(raw);
        if (!data || !data.payload || !data.expires_at) {
            return null;
        }
        if (Date.now() > data.expires_at) {
            localStorage.removeItem(ME_CACHE_KEY);
            return null;
        }
        return data.payload;
    } catch (error) {
        console.warn("Cache do header inválido:", error);
        localStorage.removeItem(ME_CACHE_KEY);
        return null;
    }
}

function setCachedMe(payload) {
    try {
        const data = {
            payload,
            expires_at: Date.now() + ME_CACHE_TTL_MS,
        };
        localStorage.setItem(ME_CACHE_KEY, JSON.stringify(data));
    } catch (error) {
        console.warn("Falha ao cachear header:", error);
    }
}

function atualizarHeaderPainel(payload) {
    const elUser = document.getElementById("painel-user-label");
    const elOficina = document.getElementById("painel-oficina-label");

    if (!elUser && !elOficina) {
        return;
    }

    const user = payload?.user || {};
    const oficina = payload?.oficina || {};

    const nome = (user.full_name || "").trim();
    const email = (user.email || "").trim();
    const displayName = nome || email || "Usuário";

    if (elUser) {
        elUser.textContent = `👤 ${displayName}`;
    }

    if (elOficina) {
        elOficina.textContent = `🏢 ${oficina.nome || "—"}`;
    }
}

async function carregarHeaderPainel() {
    const token = getAccessToken();
    if (!token) {
        logoutEIrParaLogin();
        return;
    }

    const cached = getCachedMe();
    if (cached) {
        atualizarHeaderPainel(cached);
        return;
    }

    try {
        const resp = await apiFetch("/auth/me/");
        if (!resp || !resp.ok) {
            const txt = resp ? await resp.text() : "";
            console.error("Erro ao buscar /auth/me/:", resp?.status, txt);
            return;
        }
        const data = await resp.json();
        setCachedMe(data);
        atualizarHeaderPainel(data);
    } catch (error) {
        console.error("Falha ao carregar dados do usuário:", error);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const btnLogout = document.getElementById("painel-logout-btn");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => logoutEIrParaLogin());
    }

    carregarHeaderPainel();
});
