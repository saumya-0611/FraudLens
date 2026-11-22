
/*
  Central API service for Fraud Lens.

  All frontend API requests go through this file.
  Mock mode and real backend mode use the same request function.
*/

import { mockRequest } from "../mocks/mockApi";

// Check whether mock mode is enabled in the environment.
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

export async function request(path, options = {}) {
    // Use local mock responses during frontend development.
    if (USE_MOCKS) {
        try {
            return await mockRequest(path, options);
        } catch (error) {
            // Keep mock errors in the same format as backend errors.
            throw error.data?.error || {
                code: "MOCK_ERROR",
                message: error.message || "Mock request failed.",
                request_id: null,
            };
        }
    }

    // Otherwise, send the request to the real backend.
    const response = await fetch(path, {
        ...options,

        // Include the authentication cookie with every request.
        credentials: "include",

        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    // Redirect to login when the session has expired.
    if (response.status === 401) {
        window.location.assign("/");

        throw {
            code: "UNAUTHORIZED",
            message: "Your session has expired. Please log in again.",
            request_id: null,
        };
    }

    // A 204 response has no response body.
    if (response.status === 204) {
        return null;
    }

    // Read the backend response.
    const data = await response.json();

    // Return the backend's standard error object.
    if (!response.ok) {
        throw data.error || {
            code: "REQUEST_FAILED",
            message: "The request could not be completed.",
            request_id: null,
        };
    }

    return data;
}
