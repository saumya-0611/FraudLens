import usersData from "./users.json";
import auditData from "./audit-logs.json";
import modelsData from "./models.json";
import retrainingResults from "./retraining-results.json";
import summary from "./dashboard-summary.json";
import trends from "./dashboard-trends.json";
import transactionsData from "./transactions.json";
import alertsData from "./alerts.json";
import detail from "./transaction-details.json";
import pending from "./pending-transaction.json";
import {
    addMockAccount,
    getMockSessionUser,
    mockGetCurrentUser,
    mockLogin,
    mockLogout,
    updateMockAccount,
} from "./auth";

const demoPasswords = { admin: "admin123", analyst: "analyst123", viewer: "viewer123" };
let users = usersData.items.map(user => ({ ...user, password: demoPasswords[user.username] }));
let alerts = structuredClone(alertsData.items);
let modelState = structuredClone(modelsData);
let retrainingRequestCount = 0;

const publicUser = user => Object.fromEntries(
    Object.entries(user).filter(([key]) => key !== "password"),
);

function failure(code, message, status = 400) {
    const error = new Error(message);
    error.status = status;
    error.data = { error: { code, message, request_id: "mock-request-001" } };
    throw error;
}

function bodyOf(options) {
    try {
        return JSON.parse(options.body || "{}");
    } catch {
        return failure("VALIDATION_ERROR", "Request body is not valid JSON.");
    }
}

function pageResult(items, query) {
    const page = Math.max(1, Number.parseInt(query.get("page"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.get("page_size"), 10) || 20));
    const start = (page - 1) * pageSize;
    return {
        items: items.slice(start, start + pageSize),
        page,
        page_size: pageSize,
        total: items.length,
    };
}

export async function mockRequest(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const url = new URL(path, window.location.origin);
    const { pathname, searchParams: query } = url;

    if (pathname === "/api/auth/login" && method === "POST") {
        const body = bodyOf(options);
        return mockLogin(body.username, body.password);
    }
    if (pathname === "/api/auth/me" && method === "GET") return mockGetCurrentUser();
    if (pathname === "/api/auth/logout" && method === "POST") return mockLogout();

    if (pathname === "/api/dashboard/summary" && method === "GET") return structuredClone(summary);
    if (pathname === "/api/dashboard/trends" && method === "GET") return structuredClone(trends);

    if (pathname === "/api/users" && method === "GET") {
        return { items: users.map(publicUser) };
    }
    if (pathname === "/api/users" && method === "POST") {
        const body = bodyOf(options);
        const username = String(body.username || "").trim();
        if (!username || !body.password || !["ADMIN", "ANALYST", "VIEWER"].includes(body.role)) {
            return failure("VALIDATION_ERROR", "Valid username, password, and role are required.");
        }
        if (String(body.password).trim().length < 10) {
            return failure("VALIDATION_ERROR", "Password must be at least 10 characters.");
        }
        if (users.some(user => user.username === username)) {
            return failure("CONFLICT", "Username already exists.", 409);
        }

        const user = {
            id: Math.max(0, ...users.map(item => item.id)) + 1,
            username,
            password: String(body.password),
            role: body.role,
            status: "ACTIVE",
            created_at: new Date().toISOString(),
        };
        users.push(user);
        addMockAccount(user);
        return publicUser(user);
    }
    if (pathname.startsWith("/api/users/") && method === "PATCH") {
        const id = Number(pathname.split("/").pop());
        const index = users.findIndex(user => user.id === id);
        if (index < 0) return failure("NOT_FOUND", "User not found.", 404);

        const body = bodyOf(options);
        if (body.role && !["ADMIN", "ANALYST", "VIEWER"].includes(body.role)) {
            return failure("VALIDATION_ERROR", "Invalid role.");
        }
        if (body.status && !["ACTIVE", "DISABLED"].includes(body.status)) {
            return failure("VALIDATION_ERROR", "Invalid status.");
        }
        if (Object.keys(body).some(key => !["role", "status", "password"].includes(key))) {
            return failure("VALIDATION_ERROR", "Unsupported user field.");
        }
        const sessionUser = getMockSessionUser();
        if (sessionUser?.id === id && (body.status === "DISABLED" || (body.role && body.role !== "ADMIN"))) {
            return failure("CONFLICT", "An administrator cannot disable or demote their own account.", 409);
        }

        users[index] = {
            ...users[index],
            ...(body.role ? { role: body.role } : {}),
            ...(body.status ? { status: body.status } : {}),
            ...(body.password ? { password: String(body.password) } : {}),
        };
        updateMockAccount(id, body);
        return publicUser(users[index]);
    }

    if (pathname === "/api/transactions" && method === "GET") {
        let items = [...transactionsData.items, pending];
        const risk = query.get("risk");
        const search = query.get("q")?.toLowerCase();
        const from = query.get("from");
        const to = query.get("to");
        if (risk) items = items.filter(item => item.risk_category === risk);
        if (search) {
            items = items.filter(item =>
                `${item.transaction_id} ${item.account_masked} ${item.merchant || ""} ${item.category || ""}`
                    .toLowerCase().includes(search),
            );
        }
        if (from) items = items.filter(item => new Date(item.tx_time) >= new Date(from));
        if (to) items = items.filter(item => new Date(item.tx_time) <= new Date(to));
        return pageResult(items, query);
    }
    if (pathname.startsWith("/api/transactions/") && method === "GET") {
        const id = decodeURIComponent(pathname.split("/").pop());
        if (id === detail.transaction_id) return structuredClone(detail);
        if (id === pending.transaction_id) return structuredClone(pending);
        return failure("NOT_FOUND", "Transaction not found.", 404);
    }

    if (pathname === "/api/alerts" && method === "GET") {
        const state = query.get("state");
        const items = state ? alerts.filter(alert => alert.state === state) : alerts;
        return pageResult(structuredClone(items), query);
    }
    if (pathname.startsWith("/api/alerts/") && method === "PATCH") {
        const id = Number(pathname.split("/").pop());
        const index = alerts.findIndex(alert => alert.alert_id === id);
        if (index < 0) return failure("NOT_FOUND", "Alert not found.", 404);
        const body = bodyOf(options);
        if (!["UNDER_REVIEW", "RESOLVED"].includes(body.state)) {
            return failure("VALIDATION_ERROR", "State must be UNDER_REVIEW or RESOLVED.");
        }
        if (body.state === "UNDER_REVIEW" && body.resolution !== undefined) {
            return failure("VALIDATION_ERROR", "Resolution can only be provided when resolving an alert.");
        }
        if (body.state === "RESOLVED" && !["CONFIRMED_FRAUD", "FALSE_POSITIVE"].includes(body.resolution)) {
            return failure("VALIDATION_ERROR", "Resolution must be CONFIRMED_FRAUD or FALSE_POSITIVE.");
        }
        const current = alerts[index];
        if (current.state === "RESOLVED") return failure("CONFLICT", "Resolved alerts cannot be changed.", 409);
        if (body.state === "UNDER_REVIEW" && current.state !== "NEW") {
            return failure("CONFLICT", "Invalid alert state transition.", 409);
        }

        const sessionUser = getMockSessionUser();
        alerts[index] = {
            ...current,
            state: body.state,
            resolution: body.state === "RESOLVED" ? body.resolution : null,
            resolved_by: body.state === "RESOLVED" ? sessionUser?.id || null : null,
            updated_at: new Date().toISOString(),
        };
        const { alert_id, transaction_id, risk_score, state: newState, resolution, resolved_by, created_at, updated_at } = alerts[index];
        return { alert_id, transaction_id, risk_score, state: newState, resolution, resolved_by, created_at, updated_at };
    }

    if (pathname === "/api/audit-logs" && method === "GET") {
        let items = [...auditData.items];
        const action = query.get("action");
        const username = query.get("username");
        if (action) items = items.filter(item => item.action === action);
        if (username) items = items.filter(item => item.username === username);
        return pageResult(items, query);
    }

    if (pathname === "/api/models" && method === "GET") return structuredClone(modelState);
    if (pathname === "/api/models/drift-check" && method === "POST") {
        modelState.latest_drift = {
            id: 2,
            created_at: new Date().toISOString(),
            model_version: modelState.active_version,
            psi_score: 0.08,
            psi_features: { amount: 0.04 },
            status: "OK",
            sample_size: 1000,
        };
        return structuredClone(modelState.latest_drift);
    }
    if (pathname === "/api/models/retrain" && method === "POST") {
        // Fixture-only behavior. It does not train or evaluate a real model.
        const fixture = retrainingResults[retrainingRequestCount++ % retrainingResults.length];
        const version = `v${modelState.models.length + 1}`;
        const result = { version, status: fixture.status, metrics: structuredClone(fixture.metrics) };
        modelState.models.push({
            version,
            algorithm: "xgboost+isolation_forest",
            metrics: result.metrics,
            status: result.status,
            artifact_path: "mock",
            sha256: "0".repeat(64),
            created_at: new Date().toISOString(),
        });
        return result;
    }
    if (pathname.startsWith("/api/models/") && pathname.endsWith("/activate") && method === "POST") {
        const version = decodeURIComponent(pathname.split("/")[3]);
        const model = modelState.models.find(item => item.version === version);
        if (!model) return failure("NOT_FOUND", "Model not found.", 404);
        if (!["VALIDATED", "ACTIVE", "RETIRED"].includes(model.status)) {
            return failure("CONFLICT", "Model is not validated.", 409);
        }

        modelState.models.forEach(item => {
            if (item.status === "ACTIVE") item.status = "RETIRED";
        });
        model.status = "ACTIVE";
        model.activated_at = new Date().toISOString();
        modelState.active_version = version;
        return { active_version: version, status: "ACTIVE", activated_at: model.activated_at };
    }

    return failure("NOT_FOUND", `No mock response for ${method} ${pathname}.`, 404);
}
