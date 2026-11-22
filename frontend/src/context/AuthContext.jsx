
import {
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";

import { request } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Check whether a user already has a valid session.
    useEffect(() => {
        let active = true;

        async function loadUser() {
            try {
                const currentUser = await request("/api/auth/me");

                if (active) {
                    setUser(currentUser);
                }
            } catch {
                if (active) {
                    setUser(null);
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

        setUser({
            username: result.username,
            role: result.role,
        });

        return result;
    }

    // Log out and clear the current user.
    async function logout() {
        try {
            await request("/api/auth/logout", {
                method: "POST",
            });
        } finally {
            setUser(null);
        }
    }

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                login,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// Custom hook for accessing authentication anywhere.
export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error("useAuth must be used inside AuthProvider.");
    }

    return context;
}
