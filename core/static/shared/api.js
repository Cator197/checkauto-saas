function resolveAuthContext(context) {
    if (context) {
        return context;
    }

    return window.location.pathname.startsWith("/pwa") ? "pwa" : "painel";
}

function getAccessToken() {
    return localStorage.getItem("checkauto_access") || "";
}

function getRefreshToken() {
    return localStorage.getItem("checkauto_refresh") || "";
}

function saveAccessToken(token) {
    if (token) {
        localStorage.setItem("checkauto_access", token);
    }
}

function saveRefreshToken(token) {
    if (token) {
        localStorage.setItem("checkauto_refresh", token);
    }
}

function clearAuthStorage() {
    localStorage.removeItem("checkauto_access");
    localStorage.removeItem("checkauto_refresh");
    // Token legado
    localStorage.removeItem("checkauto_token");
}

function redirectAfterLogout(context) {
    const resolved = resolveAuthContext(context);

    clearAuthStorage();

    if (resolved === "pwa") {
        window.location.href = "/pwa/";
        return;
    }

    window.location.href = "/painel/login/";
}

async function refreshAccessToken(refreshToken) {
    if (!refreshToken) {
        return null;
    }

    try {
        const resp = await fetch("/api/refresh/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ refresh: refreshToken }),
        });

        if (!resp.ok) {
            return null;
        }

        const data = await resp.json().catch(() => ({}));
        if (!data.access) {
            return null;
        }

        saveAccessToken(data.access);
        return data.access;
    } catch (error) {
        console.error("Erro ao renovar token de acesso:", error);
        return null;
    }
}

function buildRequestOptions(options, accessToken) {
    const headers = {
        ...(options.headers || {}),
    };

    if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const body = options.body;
    const isFormData = body instanceof FormData;
    const isBlob = body instanceof Blob;
    const isJsonObject = body && typeof body === "object" && !isFormData && !isBlob;

    const preparedBody = isJsonObject ? JSON.stringify(body) : body;

    if (isJsonObject && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const finalOptions = {
        ...options,
        headers,
    };

    if (preparedBody !== undefined) {
        finalOptions.body = preparedBody;
    }

    return finalOptions;
}

async function checkautoApiFetch(url, options = {}, context = null) {
    const resolvedContext = resolveAuthContext(context);
    let accessToken = getAccessToken();
    const refreshToken = getRefreshToken();

    const performFetch = async (token) => {
        const requestOptions = buildRequestOptions(options, token);
        return fetch(url, requestOptions);
    };

    let response = await performFetch(accessToken);

    if (response.status === 401 || response.status === 403) {
        if (refreshToken) {
            const newAccess = await refreshAccessToken(refreshToken);

            if (newAccess) {
                response = await performFetch(newAccess);
                return response;
            }
        }

        redirectAfterLogout(resolvedContext);
    }

    return response;
}
