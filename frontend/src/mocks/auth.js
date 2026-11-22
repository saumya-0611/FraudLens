
/*
  Mock authentication responses for frontend development.
  These are demonstration accounts, not real credentials.
*/

const demoUsers = {
    admin: {
        username: "admin",
        password: "admin123",
        role: "ADMIN",
    },
    analyst: {
        username: "analyst",
        password: "analyst123",
        role: "ANALYST",
    },
    viewer: {
        username: "viewer",
        password: "viewer123",
        role: "VIEWER",
    },
};

let currentUser = null;

export function mockLogin(username, password) {
    const user = demoUsers[username];

    if (!user || user.password !== password) {
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

    currentUser = {
        username: user.username,
        role: user.role,
    };

    return {
        username: user.username,
        role: user.role,
        expires_in: 3600,
    };
}

export function mockGetCurrentUser() {
    if (!currentUser) {
        const error = new Error("Not authenticated.");

        error.data = {
            error: {
                code: "UNAUTHORIZED",
                message: "Please log in.",
                request_id: "mock-auth-002",
            },
        };

        throw error;
    }

    return currentUser;
}

export function mockLogout() {
    currentUser = null;
    return null;
}
