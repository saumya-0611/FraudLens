import { useContext } from "react";
import { AuthContext } from "../context/auth-context";

// Read the current session from the nearest AuthProvider.
export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error("useAuth must be used inside AuthProvider.");
    }

    return context;
}
