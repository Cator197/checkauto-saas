function logoutEIrParaLogin() {
    redirectAfterLogout("painel");
}

async function verificarAutenticacao() {
    const token = getAccessToken();

    if (!token) {
        logoutEIrParaLogin();
        return false;
    }

    return true;
}
