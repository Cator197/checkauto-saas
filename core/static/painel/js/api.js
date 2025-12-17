function normalizeApiUrl(url) {
    const absoluteUrlPattern = /^https?:\/\//i;

    if (absoluteUrlPattern.test(url) || url.startsWith("//")) {
        return url;
    }

    if (url.startsWith("/api/")) {
        return url;
    }

    if (url.startsWith("/")) {
        return `/api${url}`;
    }

    return `/api/${url}`;
}

async function apiFetch(url, options = {}) {
    const normalizedUrl = normalizeApiUrl(url);
    return checkautoApiFetch(normalizedUrl, options, "painel");
}
