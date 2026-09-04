import { PRIMARY, PRIMARY_LIGHT, PRIMARY_MID, PRIMARY_DARK, GRADIENT_BTN } from "../../theme.js";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { getAllUsers, deleteUser } from "../../services/adminService.js";

const PINK = PRIMARY;
const WHITE = "#1e1a2e";

const AVATAR_COLORS = [
  { bg: "#E6F1FB", c: "#185FA5" },
  { bg: "#FBEAF0", c: "#993556" },
  { bg: "#EAF3DE", c: "#3B6D11" },
  { bg: "#FAEEDA", c: "#854F0B" },
  { bg: "#EEEDFE", c: "#3C3489" },
  { bg: "#E1F5EE", c: "#085041" },
];
const avc = (n) =>
  AVATAR_COLORS[(n?.charCodeAt(0) || 0) % AVATAR_COLORS.length];
const ini = (n) =>
  !n || n === "Guest"
    ? "G"
    : n
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

const StatPill = ({ label, value, color }) => (
  <div
    style={{
      background: "var(--color-background-secondary,#f5f5f5)",
      borderRadius: 8,
      padding: "12px 16px",
    }}
  >
    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>
    <div
      style={{
        fontSize: 20,
        fontWeight: 500,
        color: color || "#f1f0f5",
      }}
    >
      {value}
    </div>
  </div>
);

// ── User detail card (expandable) ─────────────────────────────────────────────
const UserDetail = ({ user, onDelete }) => (
  <div
    style={{
      background: "rgba(233,30,140,.02)",
      border: "0.5px solid rgba(233,30,140,.15)",
      borderRadius: 10,
      padding: 16,
      marginTop: 2,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
    }}
  >
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#4b5563",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Account info
      </div>
      {[
        { l: "User ID", v: user._id, vc: "#6b7280", small: true },
        { l: "Name", v: user.name || "—" },
        { l: "Phone", v: user.phone ? `+91 ${user.phone}` : "—" },
        {
          l: "Verified",
          v: user.isVerified ? "Yes" : "No",
          vc: user.isVerified ? "#3B6D11" : "#A32D2D",
        },
        {
          l: "Veg Mode",
          v: user.vegMode ? "On" : "Off",
          vc: user.vegMode ? "#3B6D11" : "#6b7280",
        },
        { l: "Language", v: user.language || "English" },
        {
          l: "Joined",
          v: new Date(user.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          }),
        },
      ].map((r) => (
        <div
          key={r.l}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            borderBottom: "0.5px solid rgba(255,255,255,0.05)",
            fontSize: 13,
          }}
        >
          <span style={{ color: "#6b7280" }}>{r.l}</span>
          <span
            style={{
              fontWeight: 500,
              color: r.vc || "#f1f0f5",
              fontSize: r.small ? 11 : 13,
              fontFamily: r.small ? "monospace" : "inherit",
            }}
          >
            {r.small ? r.v.slice(-8) + "…" : r.v}
          </span>
        </div>
      ))}
    </div>
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#4b5563",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Actions
      </div>
      <div
        style={{
          background: "#fff5f5",
          border: "0.5px solid #fca5a5",
          borderRadius: 10,
          padding: 14,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "#7f1d1d",
            marginBottom: 6,
          }}
        >
          Delete account
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#b91c1c",
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          This will permanently remove the user. Their orders will remain in the
          system.
        </div>
        <button
          onClick={() => onDelete(user._id)}
          style={{
            width: "100%",
            padding: "9px",
            borderRadius: 8,
            border: "none",
            background: "#dc2626",
            color: WHITE,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Delete user
        </button>
      </div>
    </div>
  </div>
);

// ── main page ─────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [verFilter, setVerFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 12;

  useEffect(() => {
    getAllUsers()
      .then((r) => {
        setUsers(r.data?.users || []);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Failed to load users");
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user permanently?")) return;
    try {
      await deleteUser(id);
      setUsers((p) => p.filter((u) => u._id !== id));
      setExpanded(null);
      toast.success("User deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchQ =
      !q || u.name?.toLowerCase().includes(q) || u.phone?.includes(q);
    const matchV =
      verFilter === "All" ||
      (verFilter === "Verified" && u.isVerified) ||
      (verFilter === "Unverified" && !u.isVerified);
    return matchQ && matchV;
  });

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const stats = {
    total: users.length,
    verified: users.filter((u) => u.isVerified).length,
    unverified: users.filter((u) => !u.isVerified).length,
    vegMode: users.filter((u) => u.vegMode).length,
  };

  return (
    <>
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 500 }}>Users</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>
          All registered customers and guests
        </div>
      </div>

      {/* stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatPill label="Total users" value={stats.total} color="#BA7517" />
        <StatPill label="Verified" value={stats.verified} color="#1D9E75" />
        <StatPill label="Unverified" value={stats.unverified} color="#BA7517" />
        <StatPill label="Veg mode on" value={stats.vegMode} color={PINK} />
      </div>

      {/* filter bar */}
      <div
        style={{
          background: "#1e1a2e",
          border: "0.5px solid rgba(255,255,255,0.07)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name or phone…"
          style={{
            flex: 1,
            minWidth: 220,
            padding: "9px 14px",
            borderRadius: 8,
            border: "0.5px solid rgba(0,0,0,.15)",
            fontSize: 13,
            outline: "none",
            background: "#e8e6f1",
          }}
        />
        <select
          value={verFilter}
          onChange={(e) => {
            setVerFilter(e.target.value);
            setPage(1);
          }}
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            border: "0.5px solid rgba(0,0,0,.15)",
            fontSize: 13,
            background: "#ecebf4",
            cursor: "pointer",
          }}
        >
          <option value="All" >All users</option>
          <option value="Verified">Verified only</option>
          <option value="Unverified">Unverified only</option>
        </select>
        {(search || verFilter !== "All") && (
          <button
            onClick={() => {
              setSearch("");
              setVerFilter("All");
              setPage(1);
            }}
            style={{
              padding: "9px 14px",
              borderRadius: 8,
              border: `0.5px solid ${PINK}`,
              color: PINK,
              background: "#1e1a2e",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Clear ✕
          </button>
        )}
        <span style={{ fontSize: 12, color: "#4b5563", marginLeft: "auto" }}>
          {filtered.length} user{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* table */}
      <div
        style={{
          background: "#1e1a2e",
          border: "0.5px solid rgba(255,255,255,0.07)",
          borderRadius: 12,
          padding: 18,
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: "48px", color: "#4b5563" }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px", color: "#374151" }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>👤</div>
            <div style={{ fontSize: 14 }}>No users found</div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr>
                    {[
                      "",
                      "Name",
                      "Phone",
                      "Verified",
                      "Veg mode",
                      "Language",
                      "Joined",
                      "",
                    ].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          textAlign: "left",
                          padding: "9px 12px",
                          fontSize: 11,
                          color: "#6b7280",
                          fontWeight: 500,
                          borderBottom: "0.5px solid rgba(255,255,255,0.07)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((u) => {
                    const isOpen = expanded === u._id;
                    const av = avc(u.name || "G");
                    return (
                      <>
                        <tr
                          key={u._id}
                          style={{
                            borderBottom: isOpen
                              ? "none"
                              : "0.5px solid rgba(255,255,255,0.05)",
                            background: isOpen
                              ? "rgba(233,30,140,.02)"
                              : "transparent",
                          }}
                        >
                          {/* avatar */}
                          <td style={{ padding: "12px 8px 12px 12px" }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: "50%",
                                background: av.bg,
                                color: av.c,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 13,
                                fontWeight: 500,
                              }}
                            >
                              {ini(u.name)}
                            </div>
                          </td>
                          <td style={{ padding: "12px" }}>
                            <div style={{ fontWeight: 500 }}>
                              {u.name || "—"}
                            </div>
                            <div style={{ fontSize: 11, color: "#4b5563" }}>
                              ID …{u._id?.slice(-6)}
                            </div>
                          </td>
                          <td style={{ padding: "12px", color: "#9ca3af" }}>
                            {u.phone ? `+91 ${u.phone}` : "—"}
                          </td>
                          {/* verified */}
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                background: u.isVerified
                                  ? "#EAF3DE"
                                  : "#FAEEDA",
                                color: u.isVerified ? "#3B6D11" : "#854F0B",
                                padding: "3px 9px",
                                borderRadius: 20,
                                fontSize: 11,
                                fontWeight: 500,
                              }}
                            >
                              {u.isVerified ? "Verified" : "Pending"}
                            </span>
                          </td>
                          {/* veg mode */}
                          <td style={{ padding: "12px" }}>
                            <div
                              style={{
                                width: 36,
                                height: 20,
                                borderRadius: 10,
                                background: u.vegMode ? "#1D9E75" : "#ddd",
                                position: "relative",
                              }}
                            >
                              <div
                                style={{
                                  position: "absolute",
                                  top: 2,
                                  left: u.vegMode ? 18 : 2,
                                  width: 16,
                                  height: 16,
                                  borderRadius: "50%",
                                  background: "#1e1a2e",
                                  boxShadow: "0 1px 2px rgba(0,0,0,.2)",
                                }}
                              />
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "12px",
                              fontSize: 12,
                              color: "#6b7280",
                            }}
                          >
                            {u.language || "English"}
                          </td>
                          <td
                            style={{
                              padding: "12px",
                              fontSize: 12,
                              color: "#4b5563",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleDateString(
                                  "en-IN",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )
                              : "—"}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <button
                              onClick={() => setExpanded(isOpen ? null : u._id)}
                              style={{
                                padding: "5px 12px",
                                borderRadius: 8,
                                fontSize: 12,
                                cursor: "pointer",
                                border: `0.5px solid ${isOpen ? PINK : "rgba(255,255,255,0.08)"}`,
                                background: isOpen ? "#fbeaf0" : WHITE,
                                color: isOpen
                                  ? PINK
                                  : "#f1f0f5",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isOpen ? "Close ↑" : "View ↓"}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr
                            key={`${u._id}-d`}
                            style={{
                              borderBottom: "0.5px solid rgba(255,255,255,0.05)",
                            }}
                          >
                            <td
                              colSpan={8}
                              style={{ padding: "4px 12px 16px" }}
                            >
                              <UserDetail user={u} onDelete={handleDelete} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 6,
                  marginTop: 16,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "0.5px solid rgba(0,0,0,.12)",
                    background: "#1e1a2e",
                    cursor: page === 1 ? "not-allowed" : "pointer",
                    color:
                      page === 1 ? "#374151" : "#f1f0f5",
                    fontSize: 13,
                  }}
                >
                  ← Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(
                    (p) =>
                      p === 1 || p === totalPages || Math.abs(p - page) <= 1,
                  )
                  .reduce((acc, p, i, arr) => {
                    if (i > 0 && arr[i - 1] !== p - 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span
                        key={`e${i}`}
                        style={{
                          padding: "6px 4px",
                          fontSize: 13,
                          color: "#4b5563",
                        }}
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          fontSize: 13,
                          cursor: "pointer",
                          border: "none",
                          background:
                            page === p
                              ? PINK
                              : "var(--color-background-secondary,#f5f5f5)",
                          color:
                            page === p
                              ? WHITE
                              : "#f1f0f5",
                          fontWeight: page === p ? 500 : 400,
                        }}
                      >
                        {p}
                      </button>
                    ),
                  )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "0.5px solid rgba(0,0,0,.12)",
                    background: "#1e1a2e",
                    cursor: page === totalPages ? "not-allowed" : "pointer",
                    color:
                      page === totalPages
                        ? "#374151"
                        : "#f1f0f5",
                    fontSize: 13,
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
