/* Mock-only accounts. This module never writes credentials to browser storage. */
const accounts = new Map([
    ["admin", { id: 1, username: "admin", password: "admin123", role: "ADMIN", status: "ACTIVE" }],
    ["analyst", { id: 2, username: "analyst", password: "analyst123", role: "ANALYST", status: "ACTIVE" }],
    ["viewer", { id: 3, username: "viewer", password: "viewer123", role: "VIEWER", status: "ACTIVE" }],
]);

let currentUser = null;

export function mockLogin(username, password) {
    const user = accounts.get(String(username || "").trim());

    if (!user || user.status !== "ACTIVE" || user.password !== password) {
        const error = new Error("Invalid username or password.");
        error.data = {
            error: {
                code: "INVALID_CREDENTIALS",
                message: "Invalid username or password.",
                request_id: "mock-auth-001",
            },
        };
        throw error;
    }

    currentUser = { id: user.id, username: user.username, role: user.role };
    return { username: user.username, role: user.role, expires_in: 7200 };
}

export function mockGetCurrentUser() {
    if (!currentUser) {
        const error = new Error("Not authenticated.");
        error.data = {
            error: {
                code: "UNAUTHENTICATED",
                message: "Authentication required.",
                request_id: "mock-auth-002",
            },
        };
        throw error;
    }

    return { username: currentUser.username, role: currentUser.role };
}

export function getMockSessionUser() {
    return currentUser ? { ...currentUser } : null;
}

export function addMockAccount(account) {
    accounts.set(account.username, { ...account });
}

export function updateMockAccount(id, changes) {
    const account = [...accounts.values()].find(item => item.id === id);
    if (!account) return;

    if (changes.role) account.role = changes.role;
    if (changes.status) account.status = changes.status;
    if (changes.password) account.password = String(changes.password);
    if (currentUser?.id === id) {
        currentUser = { id, username: account.username, role: account.role };
    }
}

export function mockLogout() {
    currentUser = null;
    return null;
}
