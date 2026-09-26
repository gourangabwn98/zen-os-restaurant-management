import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { updateProfile } from "../services/authService.js";
import { disconnectSocket } from "../services/socketService.js";
import { enablePushNotifications, disablePushNotifications, isPushEnabled, needsIosHomeScreenInstall } from "../services/notificationService.js";
import Button from "../components/ui/Button.jsx";
import { getTheme, setTheme } from "../theme.js";

export default function ProfilePage() {
  const nav = useNavigate();
  const { auth } = useAppState();

  return (
    <>
      <div className="page-h">
        <h2>Profile</h2>
        <p>{auth.isLoggedIn ? "Your account and preferences." : "You're browsing as a guest."}</p>
      </div>
      {auth.isLoggedIn ? <LoggedInView nav={nav} auth={auth} /> : <GuestView />}
      <AppearanceCard />
      <p className="muted small center" style={{ marginTop: 18 }}>Powered by Zen OS · eZentix Labs</p>
    </>
  );
}

function GuestView() {
  return (
    <>
      <div className="card center" style={{ padding: "28px 18px" }}>
        <div className="avatar" style={{ margin: "0 auto" }}>👤</div>
        <div style={{ fontWeight: 800, fontSize: 17, marginTop: 14 }}>Log in to save your orders</div>
        <p className="muted small" style={{ marginTop: 6, lineHeight: 1.5 }}>
          Your order history and details stay with you for next time.
        </p>
        <Link to="/login" className="btn btn-primary" style={{ marginTop: 18 }}>Log In / Register</Link>
        <Link to="/" className="btn btn-ghost">Continue as Guest</Link>
      </div>
      <div className="card menu-list" style={{ padding: "2px 14px" }}>
        <MenuRow icon="❤️" label="Favorites" to="/favorites" />
        <MenuRow icon="🧾" label="My Orders" to="/orders" />
        <MenuRow icon="💬" label="Help & Support" to="/help" />
      </div>
    </>
  );
}

function LoggedInView({ nav, auth }) {
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(auth.user.name || "");
  const [saving, setSaving]   = useState(false);
  const [pushOn, setPushOn]   = useState(isPushEnabled);
  const [pushBusy, setPushBusy] = useState(false);

  const handleTogglePush = async () => {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePushNotifications();
        setPushOn(false);
        toast.success("Offer notifications turned off");
      } else {
        const ok = await enablePushNotifications();
        setPushOn(ok);
        if (ok) {
          toast.success("You'll now get offer notifications");
        } else if (needsIosHomeScreenInstall()) {
          toast.error('On iPhone: tap Share → "Add to Home Screen", then open the app from there to enable notifications', { duration: 6000 });
        } else {
          toast.error("Enable notifications in your browser settings to turn this on");
        }
      }
    } catch (err) {
      console.error("Notification toggle failed:", err);
      toast.error("Couldn't update notification settings");
    } finally {
      setPushBusy(false);
    }
  };

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
    <>
      <div className="card" style={{ padding: "18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="avatar">{(auth.user.name || "?").charAt(0).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {editing ? (
              <label className="field" style={{ margin: 0 }}>
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" maxLength={40} />
              </label>
            ) : (
              <div style={{ fontWeight: 800, fontSize: 17, overflowWrap: "anywhere" }}>{auth.user.name || "Add your name"}</div>
            )}
            <div className="muted small" style={{ marginTop: 2 }}>+91 {auth.user.phone}</div>
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          {editing ? (
            <>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setName(auth.user.name || ""); }}>Cancel</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)}>✏️ Edit profile</Button>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }} aria-hidden="true">🔔</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Offer notifications</b>
            <div className="muted small">Get notified about offers, even when the app is closed</div>
          </div>
          <button
            type="button" role="switch" className="switch" aria-checked={pushOn}
            onClick={handleTogglePush} disabled={pushBusy} aria-label="Offer notifications"
          />
        </div>
        {!pushOn && needsIosHomeScreenInstall() && (
          <p className="muted tiny" style={{ marginTop: 10, lineHeight: 1.45 }}>
            📲 On iPhone, notifications only work once this is added to your Home Screen: tap{" "}
            <b style={{ color: "var(--text)" }}>Share → "Add to Home Screen"</b>, then open the app from there.
          </p>
        )}
      </div>

      <div className="card menu-list" style={{ padding: "2px 14px" }}>
        <MenuRow icon="❤️" label="Favorites" to="/favorites" />
        <MenuRow icon="🧾" label="My Orders" to="/orders" />
        <MenuRow icon="💬" label="Help & Support" to="/help" />
        <MenuRow icon="🚪" label="Log out" onClick={handleLogout} danger />
      </div>
    </>
  );
}

/** Light / dark theme (client-only, remembered on this phone). */
function AppearanceCard() {
  const [theme, setLocal] = useState(getTheme);
  const pick = (t) => { setTheme(t); setLocal(t); };
  return (
    <div className="card">
      <b>Appearance</b>
      <div className="seg" role="group" aria-label="Theme" style={{ marginTop: 10 }}>
        <button type="button" aria-pressed={theme === "light"} onClick={() => pick("light")}>☀️ Light</button>
        <button type="button" aria-pressed={theme === "dark"} onClick={() => pick("dark")}>🌙 Dark</button>
      </div>
    </div>
  );
}

function MenuRow({ icon, label, to, onClick, danger }) {
  const inner = (
    <>
      <span className="ic" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <span className="chev" aria-hidden="true">›</span>
    </>
  );
  const cls = `row${danger ? " danger" : ""}`;
  return to
    ? <Link to={to} className={cls} style={{ textDecoration: "none" }}>{inner}</Link>
    : <button type="button" className={cls} onClick={onClick}>{inner}</button>;
}
