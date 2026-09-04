export default function EmptyState({ icon = "📭", title = "Nothing here", sub }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#6b7280" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 500, color: "#9ca3af", marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: "#4b5563" }}>{sub}</div>}
    </div>
  );
}
