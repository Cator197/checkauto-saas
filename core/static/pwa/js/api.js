function logoutEIrParaPwa() {
    redirectAfterLogout("pwa");
}

async function apiFetch(url, options = {}) {
    return checkautoApiFetch(url, options, "pwa");
}

function verificarAutenticacaoPwa() {
    const token = getAccessToken();

    if (!token) {
        logoutEIrParaPwa();
        return false;
    }

    return true;
}
