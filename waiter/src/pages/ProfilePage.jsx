import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { disconnectSocket } from "../services/socketService.js";
import { getMyDashboard } from "../services/authService.js";
import { BLUE, TEXT_FAINT, BORDER, RED, NAV_HEIGHT } from "../theme.js";

export default function ProfilePage() {
  const nav = useNavigate();
  const { auth } = useAppState();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getMyDashboard().then(({ data }) => setStats(data.stats)).catch(() => {});
  }, []);

  const handleLogout = () => {
    if (!window.confirm("Sign out?")) return;
    disconnectSocket();
    auth.logout();
    toast.success("Signed out");
    nav("/login", { replace: true });
  };

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 20 }}>
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Profile</div>

      <div style={{ margin: 16, padding: "22px 18px", background: "#fff", borderRadius: 16, border: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 54, height: 54, borderRadius: "50%", background: "rgba(37,99,235,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: BLUE,
          }}>
            {(auth.user?.name || "?").charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{auth.user?.name || "Waiter"}</div>
            <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 2 }}>+91 {auth.user?.phone}</div>
            <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 1, textTransform: "capitalize" }}>{auth.user?.role || "waiter"}</div>
          </div>
        </div>
      </div>

      {auth.user?.restaurantName && (
        <div style={{ margin: "0 16px 16px", fontSize: 12.5, color: TEXT_FAINT, textAlign: "center" }}>
          {auth.user.restaurantName}
        </div>
      )}

      {stats && (
        <div style={{ margin: "0 16px 16px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, textTransform: "uppercase", marginBottom: 8 }}>
            Today's Statistics
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <StatBox label="Orders Today" value={stats.ordersToday} />
            <StatBox label="Active" value={stats.pending} />
            <StatBox label="Completed" value={stats.completed} />
          </div>
        </div>
      )}

      <div style={{ margin: "0 16px" }}>
        <div onClick={handleLogout} style={{
          display: "flex", alignItems: "center", gap: 12, padding: "15px 4px",
          borderBottom: `1px solid ${BORDER}`, cursor: "pointer",
        }}>
          <span style={{ fontSize: 17 }}>🚪</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: RED }}>Sign Out</span>
        </div>
      </div>
    </div>
  );
}

const StatBox = ({ label, value }) => (
  <div style={{ textAlign: "center", padding: "14px 6px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12 }}>
    <div style={{ fontSize: 20, fontWeight: 800, color: BLUE }}>{value ?? 0}</div>
    <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 4 }}>{label}</div>
  </div>
);
