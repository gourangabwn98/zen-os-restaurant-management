// src/pages/admin/shared/PageHeader.jsx
export default function PageHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 20, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{sub}</div>
    </div>
  );
}
