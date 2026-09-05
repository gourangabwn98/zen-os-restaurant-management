// src/pages/admin/shared/PageHeader.jsx
export default function PageHeader({ title, sub, right }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      marginBottom: 20, flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.025em", color: "var(--text-1)" }}>
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2 }}>{sub}</div>
        )}
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{right}</div>}
    </div>
  );
}
