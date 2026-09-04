import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyDashboard } from "../services/kitchenService.js";
import { useAppState } from "../context/AppState.jsx";
import { disconnectSocket } from "../services/socketService.js";
import { CARD, BORDER, TEXT_MUTED, AMBER } from "../theme.js";

export default function ProfilePage() {
  const nav = useNavigate();
  const { auth } = useAppState();
  const [stats, setStats] = useState(null);

  useEffect(() => { getMyDashboard().then(({ data }) => setStats(data.stats)).catch(() => {}); }, []);

  const handleLogout = () => {
    disconnectSocket();
    auth.logout();
    nav("/login", { replace: true });
  };

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
      <button onClick={() => nav("/board")} style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 14, marginBottom: 16, cursor: "pointer" }}>← Board</button>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 22, textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🧑‍🍳</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Welcome {auth.user?.name}</div>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 2, textTransform: "uppercase" }}>Role: {auth.user?.role}</div>
      </div>

      <div style={{ marginTop: 18, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14 }}>Today's Statistics</div>
        {!stats ? (
          <div style={{ color: TEXT_MUTED, fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Stat label="Prepared Today" value={stats.preparedToday} highlight />
            <Stat label="Preparing" value={stats.preparing} />
            <Stat label="Ready" value={stats.ready} />
            <Stat label="Completed" value={stats.completedToday} />
          </div>
        )}
      </div>

      <button onClick={handleLogout} style={{
        marginTop: 20, width: "100%", padding: 14, borderRadius: 12, border: "none",
        background: "#ef4444", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer",
      }}>
        Sign Out
      </button>
    </div>
  );
}

const Stat = ({ label, value, highlight }) => (
  <div style={{ textAlign: "center", padding: "14px 8px", background: "#0f1218", borderRadius: 12 }}>
    <div style={{ fontSize: 26, fontWeight: 800, color: highlight ? AMBER : "#fff" }}>{value ?? 0}</div>
    <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>{label}</div>
  </div>
);
