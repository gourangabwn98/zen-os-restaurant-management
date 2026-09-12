import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { disconnectSocket } from "../services/socketService.js";
import { getMyDashboard } from "../services/authService.js";
import GlassCard from "../components/ui/GlassCard.jsx";
import { ACCENT, ACCENT_GRADIENT, TEXT_FAINT, NAV_HEIGHT } from "../theme.js";

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
      <div style={{ padding: "20px 16px 10px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Profile</div>

      <div style={{ margin: "12px 16px" }}>
        <GlassCard style={{ padding: "22px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 54, height: 54, borderRadius: "50%", background: ACCENT_GRADIENT,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#fff",
            }}>
              {(auth.user?.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>{auth.user?.name || "Waiter"}</div>
              <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 2 }}>+91 {auth.user?.phone}</div>
              <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 1, textTransform: "capitalize" }}>{auth.user?.role || "waiter"}</div>
            </div>
          </div>
        </GlassCard>
      </div>

      {auth.user?.restaurantName && (
        <div style={{ margin: "0 16px 16px", fontSize: 12.5, color: TEXT_FAINT, textAlign: "center" }}>
          {auth.user.restaurantName}
        </div>
      )}

      {stats && (
        <div style={{ margin: "0 16px 16px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, textTransform: "uppercase", marginBottom: 10, letterSpacing: 0.5 }}>
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
        <GlassCard style={{ padding: "4px 4px" }}>
          <div onClick={handleLogout} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "15px 12px", cursor: "pointer",
          }}>
            <span style={{ fontSize: 17 }}>🚪</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#F87171" }}>Sign Out</span>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

const StatBox = ({ label, value }) => (
  <GlassCard style={{ textAlign: "center", padding: "16px 6px" }}>
    <div style={{ fontSize: 21, fontWeight: 800, color: ACCENT }}>{value ?? 0}</div>
    <div style={{ fontSize: 10, color: TEXT_FAINT, marginTop: 4 }}>{label}</div>
  </GlassCard>
);
