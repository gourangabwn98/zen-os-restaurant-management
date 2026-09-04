// src/pages/admin/shared/Card.jsx
import { W } from "./constants";

export default function Card({ title, children, mb }) {
  return (
    <div
      style={{
        background: W,
        border: "0.5px solid #eee",
        borderRadius: 12,
        padding: 18,
        marginBottom: mb ? 20 : 0,
      }}
    >
      {title && (
        <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 14 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
