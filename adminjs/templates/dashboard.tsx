// src/admin/dashboard.tsx
// Redirect-only dashboard — jumps straight to a chosen resource list.
// Register in AdminJS config: dashboard: { component: Components.Dashboard }
//
// To customize the target, edit the navigate() path.

import { useEffect } from "react";
import { useNavigate } from "react-router";

const Dashboard = () => {
    const navigate = useNavigate();

    useEffect(() => {
        navigate("/admin/resources/users"); // ← change to your entry resource
    }, [navigate]);

    return null;
};

export default Dashboard;
