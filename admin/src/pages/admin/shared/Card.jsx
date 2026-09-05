// src/pages/admin/shared/Card.jsx
export default function Card({ title, children, mb, style }) {
  return (
    <div
      className="zc-card"
      style={{ padding: 18, marginBottom: mb ? 20 : 0, ...style }}
    >
      {title && (
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14, color: "var(--text-1)" }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
