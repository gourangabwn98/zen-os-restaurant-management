import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { updateProfile } from "../services/authService.js";
import { disconnectSocket } from "../services/socketService.js";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import { ACCENT, ACCENT_SOFT, ACCENT_GRADIENT, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";

export default function ProfilePage() {
  const nav = useNavigate();
  const { auth } = useAppState();

  if (!auth.isLoggedIn) return <GuestView nav={nav} />;
  return <LoggedInView nav={nav} auth={auth} />;
}

function GuestView({ nav }) {
  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 20, paddingTop: 8 }}>
      <div style={{ padding: "20px 16px 10px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Profile</div>

      <div style={{ margin: "12px 16px" }}>
        <GlassCard style={{ textAlign: "center", padding: "36px 20px" }}>
          <div style={{
            width: 60, height: 60, margin: "0 auto", borderRadius: "50%", background: ACCENT_SOFT,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
          }}>
            👤
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, marginTop: 14, color: "#fff" }}>You're browsing as a guest</div>
          <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 6, lineHeight: 1.5 }}>
            Log in to save your order history and details for next time.
          </div>

          <div style={{ marginTop: 22 }}>
            <PrimaryButton onClick={() => nav("/login")}>Log In / Register</PrimaryButton>
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={() => nav("/")} style={{
              width: "100%", padding: 13, borderRadius: 14, border: `1.5px solid ${GLASS_BORDER}`,
              background: "rgba(255,255,255,0.05)", color: TEXT_MUTED, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
            }}>
              Continue as Guest
            </button>
          </div>
        </GlassCard>
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
      <div style={{ padding: "20px 16px 10px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Profile</div>

      <div style={{ margin: "12px 16px" }}>
        <GlassCard style={{ padding: "22px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 54, height: 54, borderRadius: "50%", background: ACCENT_GRADIENT,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#fff",
            }}>
              {(auth.user.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              {editing ? (
                <input
                  value={name} onChange={(e) => setName(e.target.value)} autoFocus
                  style={{
                    padding: "7px 10px", borderRadius: 8, border: `1px solid ${GLASS_BORDER}`,
                    background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, fontWeight: 700,
                  }}
                />
              ) : (
                <div style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>{auth.user.name || "Add your name"}</div>
              )}
              <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 2 }}>+91 {auth.user.phone}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            {editing ? (
              <>
                <PrimaryButton onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
                  {saving ? "Saving…" : "Save"}
                </PrimaryButton>
                <button onClick={() => { setEditing(false); setName(auth.user.name || ""); }} style={outlineBtn}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} style={{ ...outlineBtn, color: ACCENT, borderColor: "rgba(255,138,0,0.5)" }}>
                ✏️ Edit Profile
              </button>
            )}
          </div>
        </GlassCard>
      </div>

      <div style={{ margin: "8px 16px" }}>
        <GlassCard style={{ padding: "4px 4px" }}>
          <MenuRow icon="❤️" label="Favorites" onClick={() => nav("/favorites")} />
          <MenuRow icon="🧾" label="My Orders" onClick={() => nav("/orders")} />
          <MenuRow icon="💬" label="Help & Support" onClick={() => nav("/help")} />
          <MenuRow icon="🚪" label="Log Out" onClick={handleLogout} danger last />
        </GlassCard>
      </div>
    </div>
  );
}

const outlineBtn = {
  flex: 1, padding: "10px 12px", borderRadius: 10, fontWeight: 700, fontSize: 13,
  border: `1.5px solid ${GLASS_BORDER}`, background: "rgba(255,255,255,0.05)", color: TEXT_MUTED, cursor: "pointer",
};

const MenuRow = ({ icon, label, onClick, danger, last }) => (
  <div onClick={onClick} style={{
    display: "flex", alignItems: "center", gap: 12, padding: "15px 12px",
    borderBottom: last ? "none" : `1px solid ${GLASS_BORDER}`, cursor: "pointer",
  }}>
    <span style={{ fontSize: 17 }}>{icon}</span>
    <span style={{ fontSize: 14, fontWeight: 600, color: danger ? "#F87171" : "#fff" }}>{label}</span>
    <span style={{ marginLeft: "auto", color: TEXT_FAINT }}>›</span>
  </div>
);
