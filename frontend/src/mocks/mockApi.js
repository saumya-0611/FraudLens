
/*
  Mock API service for Fraud Lens.

  This file simulates the backend using local JSON files.
  It is used only when VITE_USE_MOCKS=true.
*/

import users from "./users.json";
import auditLogs from "./audit-logs.json";
import models from "./models.json";
import dashboardSummary from "./dashboard-summary.json";
import dashboardTrends from "./dashboard-trends.json";
import transactions from "./transactions.json";
import alerts from "./alerts.json";
import transactionDetails from "./transaction-details.json";
import pendingTransaction from "./pending-transaction.json";

import {
    mockLogin,
    mockGetCurrentUser,
    mockLogout,
} from "./auth";

// Keep alert changes in memory while the app is running.
let mockAlerts = [...alerts.items];

// Keep user changes in memory while the app is running.
let mockUsers = [...users.items];

// Create a standard contract-style error.
function createError(code, message, status = 400) {
    const error = new Error(message);

    error.status = status;
    error.data = {
        error: {
            code,
            message,
            request_id: "mock-request-001",
        },
    };

    return error;
}

// Return mock responses for supported API endpoints.
export async function mockRequest(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();

    const url = new URL(path, window.location.origin);
    const pathname = url.pathname;
    const searchParams = url.searchParams;

    // --------------------------------
    // AUTHENTICATION
    // --------------------------------

    // Login.
    if (pathname === "/api/auth/login" && method === "POST") {
        const body = JSON.parse(options.body || "{}");

        return mockLogin(body.username, body.password);
    }

    // Get current logged-in user.
    if (pathname === "/api/auth/me" && method === "GET") {
        return mockGetCurrentUser();
    }

    // Logout.
    if (pathname === "/api/auth/logout" && method === "POST") {
        return mockLogout();
    }

    // --------------------------------
    // ADMIN: USERS
    // --------------------------------

    // Get all users.
    if (pathname === "/api/users" && method === "GET") {
        return {
            items: mockUsers,
        };
    }

    // Create a new user.
    if (pathname === "/api/users" && method === "POST") {
        const body = JSON.parse(options.body || "{}");

        if (!body.username || !body.password || !body.role) {
            throw createError(
                "VALIDATION_ERROR",
                "Username, password and role are required."
            );
        }

        if (!["ADMIN", "ANALYST", "VIEWER"].includes(body.role)) {
            throw createError(
                "VALIDATION_ERROR",
                "Invalid user role."
            );
        }

        const existingUser = mockUsers.find(
            (user) => user.username === body.username
        );

        if (existingUser) {
            throw createError(
                "CONFLICT",
                "Username already exists.",
                409
            );
        }

        const newUser = {
            id: Math.max(0, ...mockUsers.map((user) => user.id)) + 1,
            username: body.username,
            role: body.role,
            status: "ACTIVE",
            created_at: new Date().toISOString(),
        };

        mockUsers.push(newUser);

        return newUser;
    }

    // Update an existing user.
    if (
        pathname.startsWith("/api/users/") &&
        method === "PATCH"
    ) {
        const userId = Number(pathname.split("/").pop());
        const body = JSON.parse(options.body || "{}");

        const userIndex = mockUsers.findIndex(
            (user) => user.id === userId
        );

        if (userIndex === -1) {
            throw createError(
                "NOT_FOUND",
                "User was not found.",
                404
            );
        }

        const allowedFields = ["role", "status", "password"];

        const invalidField = Object.keys(body).some(
            (field) => !allowedFields.includes(field)
        );

        if (invalidField) {
            throw createError(
                "VALIDATION_ERROR",
                "An unsupported user field was provided."
            );
        }

        if (
            body.role &&
            !["ADMIN", "ANALYST", "VIEWER"].includes(body.role)
        ) {
            throw createError(
                "VALIDATION_ERROR",
                "Invalid user role."
            );
        }

        if (
            body.status &&
            !["ACTIVE", "DISABLED"].includes(body.status)
        ) {
            throw createError(
                "VALIDATION_ERROR",
                "Invalid user status."
            );
        }

        const updatedUser = {
            ...mockUsers[userIndex],
            ...(body.role && { role: body.role }),
            ...(body.status && { status: body.status }),
        };

        mockUsers[userIndex] = updatedUser;

        return updatedUser;
    }

    // --------------------------------
    // DASHBOARD
    // --------------------------------

    // Dashboard summary.
    if (pathname === "/api/dashboard/summary" && method === "GET") {
        return dashboardSummary;
    }

    // Dashboard trends.
    if (pathname === "/api/dashboard/trends" && method === "GET") {
        return dashboardTrends;
    }

    // --------------------------------
    // TRANSACTIONS
    // --------------------------------

    // Transaction list with filtering and pagination.
    if (pathname === "/api/transactions" && method === "GET") {
        const page = Number(searchParams.get("page") || 1);
        const pageSize = Number(searchParams.get("page_size") || 20);
        const risk = searchParams.get("risk");
        const query = searchParams.get("q")?.toLowerCase();

        let items = [...transactions.items];

        if (risk) {
            items = items.filter(
                (item) => item.risk_category === risk
            );
        }

        if (query) {
            items = items.filter(
                (item) =>
                    item.transaction_id.toLowerCase().includes(query) ||
                    item.account_masked.toLowerCase().includes(query)
            );
        }

        const start = (page - 1) * pageSize;

        return {
            items: items.slice(start, start + pageSize),
            page,
            page_size: pageSize,
            total: items.length,
        };
    }

    // Pending transaction.
    if (
        pathname === "/api/transactions/TXN-1004" &&
        method === "GET"
    ) {
        return pendingTransaction;
    }

    // Transaction details.
    if (
        pathname.startsWith("/api/transactions/") &&
        method === "GET"
    ) {
        const transactionId = pathname.split("/").pop();

        if (transactionId === transactionDetails.transaction_id) {
            return transactionDetails;
        }

        throw createError(
            "TRANSACTION_NOT_FOUND",
            "Transaction was not found.",
            404
        );
    }

    // --------------------------------
    // FRAUD ALERTS
    // --------------------------------

    // Alert list with filtering and pagination.
    if (pathname === "/api/alerts" && method === "GET") {
        const page = Number(searchParams.get("page") || 1);
        const pageSize = Number(searchParams.get("page_size") || 20);
        const state = searchParams.get("state");

        let items = [...mockAlerts];

        if (state) {
            items = items.filter(
                (item) => item.state === state
            );
        }

        const start = (page - 1) * pageSize;

        return {
            items: items.slice(start, start + pageSize),
            page,
            page_size: pageSize,
            total: items.length,
        };
    }

    // Update an alert.
    if (
        pathname.startsWith("/api/alerts/") &&
        method === "PATCH"
    ) {
        const alertId = Number(pathname.split("/").pop());
        const body = JSON.parse(options.body || "{}");

        const alertIndex = mockAlerts.findIndex(
            (item) => item.alert_id === alertId
        );

        if (alertIndex === -1) {
            throw createError(
                "ALERT_NOT_FOUND",
                "Alert was not found.",
                404
            );
        }

        const currentAlert = mockAlerts[alertIndex];

        if (currentAlert.state === "RESOLVED") {
            throw createError(
                "ALERT_ALREADY_RESOLVED",
                "This alert has already been resolved.",
                409
            );
        }

        const validStates = [
            "NEW",
            "UNDER_REVIEW",
            "RESOLVED",
        ];

        if (!validStates.includes(body.state)) {
            throw createError(
                "INVALID_ALERT_STATE",
                "The requested alert state is invalid."
            );
        }

        if (
            body.state === "RESOLVED" &&
            ![
                "CONFIRMED_FRAUD",
                "FALSE_POSITIVE",
            ].includes(body.resolution)
        ) {
            throw createError(
                "RESOLUTION_REQUIRED",
                "Choose CONFIRMED_FRAUD or FALSE_POSITIVE."
            );
        }

        const updatedAlert = {
            ...currentAlert,
            state: body.state,
            resolution:
                body.state === "RESOLVED"
                    ? body.resolution
                    : null,
        };

        mockAlerts[alertIndex] = updatedAlert;

        return updatedAlert;
    }

    // --------------------------------
    // UNIMPLEMENTED ENDPOINT
    // --------------------------------

    throw createError(
        "MOCK_ENDPOINT_NOT_FOUND",
        `No mock response is configured for ${method} ${pathname}.`,
        404
    );
}
