import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { updateProfile } from "../services/authService.js";
import { disconnectSocket } from "../services/socketService.js";
import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER, RED, NAV_HEIGHT } from "../theme.js";

export default function ProfilePage() {
  const nav = useNavigate();
  const { auth } = useAppState();

  if (!auth.isLoggedIn) return <GuestView nav={nav} />;
  return <LoggedInView nav={nav} auth={auth} />;
}

function GuestView({ nav }) {
  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 20, paddingTop: 8 }}>
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Profile</div>

      <div style={{ margin: "20px 16px", textAlign: "center", padding: "32px 20px", background: "#fff", borderRadius: 16, border: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 40 }}>👤</div>
        <div style={{ fontWeight: 800, fontSize: 15, marginTop: 10 }}>You're browsing as a guest</div>
        <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 6, lineHeight: 1.5 }}>
          Log in to save your order history and details for next time.
        </div>

        <button onClick={() => nav("/login")} style={{
          width: "100%", marginTop: 20, padding: 14, borderRadius: 12, border: "none",
          background: PINK, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer",
        }}>
          Log In / Register
        </button>
        <button onClick={() => nav("/")} style={{
          width: "100%", marginTop: 10, padding: 13, borderRadius: 12, border: `1.5px solid ${BORDER}`,
          background: "#fff", color: TEXT_MUTED, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
        }}>
          Continue as Guest
        </button>
      </div>
    </div>
  );
}

function LoggedInView({ nav, auth }) {
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(auth.user.name || "");
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Name can't be empty");
    setSaving(true);
    try {
      await updateProfile({ name: name.trim() });
      auth.updateLocal({ name: name.trim() });
      setEditing(false);
      toast.success("Profile updated");
    } catch {
      toast.error("Couldn't update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    disconnectSocket();
    auth.logout();
    toast.success("Logged out");
    nav("/");
  };

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 20 }}>
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Profile</div>

      <div style={{ margin: "16px", padding: "22px 18px", background: "#fff", borderRadius: 16, border: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 54, height: 54, borderRadius: "50%", background: "rgba(224,17,95,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: PINK,
          }}>
            {(auth.user.name || "?").charAt(0).toUpperCase()}
          </div>
          <div>
            {editing ? (
              <input
                value={name} onChange={(e) => setName(e.target.value)} autoFocus
                style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, fontWeight: 700 }}
              />
            ) : (
              <div style={{ fontWeight: 800, fontSize: 16 }}>{auth.user.name || "Add your name"}</div>
            )}
            <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 2 }}>+91 {auth.user.phone}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving} style={smallBtn(PINK, "#fff")}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => { setEditing(false); setName(auth.user.name || ""); }} style={smallBtn("#fff", TEXT_MUTED, BORDER)}>
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} style={smallBtn("#fff", PINK, PINK)}>
              ✏️ Edit Profile
            </button>
          )}
        </div>
      </div>

      <div style={{ margin: "0 16px" }}>
        <MenuRow icon="🧾" label="My Orders" onClick={() => nav("/orders")} />
        <MenuRow icon="💬" label="Help & Support" onClick={() => nav("/help")} />
        <MenuRow icon="🚪" label="Log Out" onClick={handleLogout} danger />
      </div>
    </div>
  );
}

const smallBtn = (bg, color, border) => ({
  flex: 1, padding: "10px 12px", borderRadius: 10, fontWeight: 700, fontSize: 13,
  border: border ? `1.5px solid ${border}` : "none", background: bg, color, cursor: "pointer",
});

const MenuRow = ({ icon, label, onClick, danger }) => (
  <div onClick={onClick} style={{
    display: "flex", alignItems: "center", gap: 12, padding: "15px 4px",
    borderBottom: `1px solid ${BORDER}`, cursor: "pointer",
  }}>
    <span style={{ fontSize: 17 }}>{icon}</span>
    <span style={{ fontSize: 14, fontWeight: 600, color: danger ? RED : "#111" }}>{label}</span>
    <span style={{ marginLeft: "auto", color: TEXT_FAINT }}>›</span>
  </div>
);
