function getAccessToken() {
    return localStorage.getItem("checkauto_access") || "";
}

function clearAuthStorage() {
    localStorage.removeItem("checkauto_access");
    localStorage.removeItem("checkauto_refresh");
    localStorage.removeItem("checkauto_token");
}

function logoutEIrParaLogin() {
    clearAuthStorage();
    window.location.href = "/painel/login/";
}

async function verificarAutenticacao() {
    const token = getAccessToken();

    if (!token) {
        console.log("Sem token");
        logoutEIrParaLogin();
        return false;
    }

    try {
        const response = await fetch("/api/auth/me/", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 401 || response.status === 403) {
            console.log("Token inválido");
            logoutEIrParaLogin();
            return false;
        }

        if (!response.ok) {
            console.log("Erro ao validar token");
            return false;
        }

        return true;
    } catch (error) {
        console.log("Erro de rede");
        return false;
    }
}
