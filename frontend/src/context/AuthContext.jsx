
import {
    useEffect,
    useState,
} from "react";

import { request } from "../services/api";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState("");

    // Check whether a user already has a valid session.
    useEffect(() => {
        let active = true;

        async function loadUser() {
            try {
                const currentUser = await request("/api/auth/me");

                if (active) {
                    setUser(currentUser);
                }
            } catch (error) {
                if (active) {
                    setUser(null);
                    // Network failures are shown on the login screen; a normal 401
                    // simply means there is no existing session.
                    if (error?.code === "BACKEND_UNAVAILABLE") {
                        setAuthError(error.message);
                    }
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        loadUser();

        return () => {
            active = false;
        };
    }, []);

    // Log in using the backend authentication endpoint.
    async function login(username, password) {
        const result = await request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });

        setAuthError("");
        setUser({
            username: result.username,
            role: result.role,
        });

        return result;
    }

    // Log out and clear the current user.
    async function logout() {
        await request("/api/auth/logout", { method: "POST" });
        setUser(null);
    }

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                authError,
                login,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
