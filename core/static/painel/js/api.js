async function apiFetch(url, options = {}) {
    const token = getAccessToken();

    const headers = {
        ...(options.headers || {}),
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const body = options.body;
    const isFormData = body instanceof FormData;
    const isJsonObject = body && typeof body === "object" && !isFormData && !(body instanceof Blob);

    const finalOptions = {
        ...options,
        headers,
    };

    if (isJsonObject) {
        headers["Content-Type"] = "application/json";
        finalOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, finalOptions);

    if (response.status === 401 || response.status === 403) {
        logoutEIrParaLogin();
        throw new Error("Não autorizado");
    }

    return response;
}
