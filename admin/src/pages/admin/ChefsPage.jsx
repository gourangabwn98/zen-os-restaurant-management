import { PRIMARY } from "../../theme.js";
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { getAllChefs, createChef, updateChefStatus, deleteChef } from "../../services/adminService.js";

const PINK   = PRIMARY;
const CARD   = "#16132a";
const CARD2  = "#1c1830";
const BORDER = "rgba(255,255,255,0.07)";
const T1     = "#f1f0f5";
const T2     = "#9ca3af";
const T3     = "#4b5563";

const inp = {
  width: "100%", padding: "10px 14px", borderRadius: 8, boxSizing: "border-box",
  border: `1px solid ${BORDER}`, background: "#252038",
  color: T1, fontSize: 13, outline: "none",
};

export default function ChefsPage() {
  const [chefs,      setChefs]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [newChef,    setNewChef]    = useState({ name: "", phone: "", status: "Active" });
  const [submitting, setSubmitting] = useState(false);

  const fetchChefs = useCallback(async () => {
    try {
      const res = await getAllChefs();
      setChefs(Array.isArray(res.data) ? res.data : res.data?.chefs || []);
    } catch { toast.error("Failed to load chefs"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchChefs(); }, [fetchChefs]);

  const handleCreate = async () => {
    if (!newChef.name || !newChef.phone) return toast.error("Name and Phone required");
    if (newChef.phone.length !== 10)     return toast.error("Phone must be 10 digits");
    setSubmitting(true);
    try {
      await createChef(newChef);
      toast.success("Chef created!");
      setShowModal(false);
      setNewChef({ name: "", phone: "", status: "Active" });
      fetchChefs();
    } catch (err) { toast.error(err.response?.data?.message || "Failed to create"); }
    finally { setSubmitting(false); }
  };

  const handleToggle = async (id, cur) => {
    const next = cur === "Active" ? "Inactive" : "Active";
    try { await updateChefStatus(id, next); toast.success(`→ ${next}`); fetchChefs(); }
    catch { toast.error("Failed to update"); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await deleteChef(id); toast.success("Chef deleted"); fetchChefs(); }
    catch { toast.error("Failed to delete"); }
  };

  if (loading) return (
    <div style={{ textAlign: "center", padding: 100, color: T3 }}>Loading chefs…</div>
  );

  return (
    <div style={{ padding: 28, fontFamily: "'DM Sans',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T1, margin: 0 }}>Chef Management</h1>
          <p style={{ color: T2, marginTop: 5, fontSize: 13 }}>Create and manage chef accounts</p>
        </div>
        <button onClick={() => setShowModal(true)} style={{
          background: `linear-gradient(135deg, ${PINK}, #5b21b6)`,
          color: "#fff", border: "none", padding: "11px 22px",
          borderRadius: 25, fontWeight: 600, cursor: "pointer", fontSize: 13,
          boxShadow: `0 4px 14px ${PINK}44`,
        }}>
          + Add New Chef
        </button>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Chefs",    value: chefs.length,                                       color: PINK      },
          { label: "Active",         value: chefs.filter(c=>c.status==="Active").length,         color: "#34d399" },
          { label: "Inactive",       value: chefs.filter(c=>c.status!=="Active").length,         color: "#f87171" },
        ].map(s => (
          <div key={s.label} style={{
            background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12,
            padding: "14px 20px", minWidth: 120,
          }}>
            <div style={{ fontSize: 11, color: T2, marginBottom: 4, fontWeight: 500 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: CARD2, borderBottom: `1px solid ${BORDER}` }}>
              {["Chef Name", "Phone Number", "Status", "Actions"].map((h, i) => (
                <th key={h} style={{
                  padding: "13px 18px", textAlign: i > 1 ? "center" : "left",
                  fontSize: 11, color: T2, fontWeight: 600,
                  letterSpacing: 0.8, textTransform: "uppercase",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chefs.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 48, textAlign: "center" }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>👨‍🍳</div>
                  <div style={{ fontSize: 14, color: T2 }}>No chefs added yet</div>
                  <div style={{ fontSize: 12, color: T3, marginTop: 4 }}>Click "Add New Chef" to get started</div>
                </td>
              </tr>
            ) : chefs.map((chef, idx) => (
              <tr key={chef._id} style={{
                borderBottom: idx < chefs.length - 1 ? `1px solid ${BORDER}` : "none",
                transition: "background .12s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(139,92,246,0.05)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                {/* Name + avatar */}
                <td style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: `${PINK}20`, border: `1.5px solid ${PINK}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 700, color: PINK, flexShrink: 0,
                    }}>
                      {chef.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: T1 }}>{chef.name}</div>
                      <div style={{ fontSize: 11, color: T3, marginTop: 1 }}>
                        {new Date(chef.createdAt).toLocaleDateString("en-IN",{ day:"2-digit",month:"short",year:"numeric" })}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Phone */}
                <td style={{ padding: "14px 18px" }}>
                  <span style={{ color: T2, fontFamily: "'DM Mono',monospace", fontSize: 13 }}>
                    +91 {chef.phone}
                  </span>
                </td>

                {/* Status badge */}
                <td style={{ padding: "14px 18px", textAlign: "center" }}>
                  <span style={{
                    padding: "4px 13px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: chef.status === "Active"
                      ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                    color: chef.status === "Active" ? "#34d399" : "#f87171",
                    border: `1px solid ${chef.status==="Active" ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
                  }}>
                    {chef.status}
                  </span>
                </td>

                {/* Actions */}
                <td style={{ padding: "14px 18px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <button
                      onClick={() => handleToggle(chef._id, chef.status)}
                      style={{
                        padding: "6px 14px", borderRadius: 20, fontSize: 12,
                        fontWeight: 500, cursor: "pointer", border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.05)", color: T2, transition: "all .15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.1)"}
                      onMouseLeave={e => e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                    >
                      {chef.status === "Active" ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(chef._id, chef.name)}
                      style={{
                        padding: "6px 14px", borderRadius: 20, fontSize: 12,
                        fontWeight: 500, cursor: "pointer",
                        border: "1px solid rgba(239,68,68,0.3)",
                        background: "rgba(239,68,68,0.1)", color: "#f87171", transition: "all .15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background="rgba(239,68,68,0.2)"}
                      onMouseLeave={e => e.currentTarget.style.background="rgba(239,68,68,0.1)"}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Create Chef Modal ── */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, backdropFilter: "blur(4px)",
        }} onClick={() => setShowModal(false)}>
          <div style={{
            background: "#13111f", borderRadius: 18, width: 420, padding: 28,
            border: `1px solid rgba(139,92,246,0.25)`,
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
          }} onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div>
                <h3 style={{ margin: 0, color: T1, fontSize: 17, fontWeight: 700 }}>Add New Chef</h3>
                <p style={{ margin: "4px 0 0", color: T2, fontSize: 12 }}>Chef can log in using their phone + OTP</p>
              </div>
              <button onClick={() => setShowModal(false)} style={{
                width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`,
                background: CARD, color: T2, cursor: "pointer", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>

            {/* Name input */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: T2, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Full Name
              </label>
              <input
                placeholder="e.g. Ramesh Kumar"
                value={newChef.name}
                onChange={e => setNewChef({ ...newChef, name: e.target.value })}
                style={inp}
                onFocus={e => e.target.style.borderColor = `${PINK}66`}
                onBlur={e => e.target.style.borderColor = BORDER}
              />
            </div>

            {/* Phone input */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ fontSize: 12, color: T2, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Phone Number
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{
                  padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`,
                  background: "#1a1625", color: T2, fontSize: 13, flexShrink: 0,
                }}>
                  🇮🇳 +91
                </div>
                <input
                  type="tel" maxLength={10}
                  placeholder="10-digit number"
                  value={newChef.phone}
                  onChange={e => setNewChef({ ...newChef, phone: e.target.value.replace(/\D/g,"") })}
                  style={{ ...inp, flex: 1 }}
                  onFocus={e => e.target.style.borderColor = `${PINK}66`}
                  onBlur={e => e.target.style.borderColor = BORDER}
                />
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{
                flex: 1, padding: 12, borderRadius: 10,
                border: `1px solid ${BORDER}`, background: CARD,
                color: T2, cursor: "pointer", fontSize: 13, fontWeight: 500,
              }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={submitting} style={{
                flex: 1, padding: 12, borderRadius: 10,
                background: submitting ? "#374151" : `linear-gradient(135deg, ${PINK}, #5b21b6)`,
                color: "#fff", border: "none",
                fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", fontSize: 13,
                boxShadow: submitting ? "none" : `0 4px 14px ${PINK}44`,
              }}>
                {submitting ? "Creating…" : "Create Chef"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}