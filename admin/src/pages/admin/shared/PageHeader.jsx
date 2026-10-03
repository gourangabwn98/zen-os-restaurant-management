// src/pages/admin/shared/PageHeader.jsx
export default function PageHeader({ title, sub, right }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      marginBottom: 20, flexWrap: "wrap",
    }}>
      {/* 220px basis: on a phone the actions wrap below the title instead of
          squeezing it to a few letters. */}
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.025em", color: "var(--text-1)" }}>
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2 }}>{sub}</div>
        )}
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{right}</div>}
    </div>
  );
}
