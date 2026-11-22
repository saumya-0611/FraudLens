
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

function ProtectedRoute({ allowedRoles }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="preview-page">
                <p>Checking your session...</p>
            </div>
        );
    }

    // Send users without a session to the login page.
    if (!user) {
        return <Navigate to="/" replace />;
    }

    // Show an access-denied message if the role is not allowed.
    if (
        allowedRoles &&
        !allowedRoles.includes(user.role)
    ) {
        return (
            <div className="preview-page">
                <h1>Not allowed</h1>
                <p>You do not have permission to access this page.</p>
            </div>
        );
    }

    return <Outlet />;
}

export default ProtectedRoute;
