const mocksConfigured = import.meta.env.VITE_USE_MOCKS === "true";

if (import.meta.env.PROD && mocksConfigured) {
    throw new Error("Mock mode is development-only. Set VITE_USE_MOCKS=false for production.");
}

const USE_MOCKS = import.meta.env.DEV && mocksConfigured;
const PUBLIC_AUTH_ENDPOINTS = new Set(["/api/auth/login", "/api/auth/me"]);
const PUBLIC_ROUTES = new Set(["/", "/home"]);

function createApiError(code, message, requestId = null) {
    return { code, message, request_id: requestId };
}

async function parseResponse(response) {
    if (response.status === 204) return null;

    const responseText = await response.text();
    if (!responseText) return null;

    try {
        return JSON.parse(responseText);
    } catch {
        return null;
    }
}

export async function request(path, options = {}) {
    const { expectedStatus, ...fetchOptions } = options;
    if (USE_MOCKS) {
        try {
            const { mockRequest } = await import("../mocks/mockApi");
            return await mockRequest(path, fetchOptions);
        } catch (error) {
            throw error.data?.error || createApiError(
                "MOCK_ERROR",
                error.message || "Mock request failed.",
            );
        }
    }

    let response;
    let data;
    try {
        response = await fetch(path, {
            ...fetchOptions,
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                ...fetchOptions.headers,
            },
        });
        data = await parseResponse(response);
    } catch (error) {
        throw createApiError(
            "BACKEND_UNAVAILABLE",
            error.name === "AbortError" || error.name === "TimeoutError"
                ? "The FraudLens request timed out. Please try again."
                : "Cannot reach the FraudLens backend. Check the service and API proxy, then try again.",
        );
    }

    if (response.status === 401) {
        const endpoint = new URL(path, window.location.origin).pathname;
        const isPublicEndpoint = PUBLIC_AUTH_ENDPOINTS.has(endpoint);
        const isPublicRoute = PUBLIC_ROUTES.has(window.location.pathname);

        // Login failures and initial session checks must be rendered in place.
        // Only expire navigation when a protected screen loses its session.
        if (!isPublicEndpoint && !isPublicRoute) {
            window.location.replace("/");
        }

        throw data?.error || createApiError(
            "UNAUTHORIZED",
            isPublicEndpoint
                ? "Authentication was not accepted. Please try again."
                : "Your session has expired. Please log in again.",
        );
    }

    if (!response.ok) {
        throw { ...(data?.error || createApiError(
            "REQUEST_FAILED",
            "The request could not be completed.",
        )), status: response.status };
    }

    if (expectedStatus !== undefined && response.status !== expectedStatus) {
        throw createApiError("UNEXPECTED_STATUS", "The server returned an unexpected response status.");
    }

    return data;
}
