// src/pages/admin/employees/SectionToggle.jsx — clickable card header for the
// Employees page's collapsible sections (Staff performance & collections,
// Duty history). Closed by default; the section loads its data only once opened.
export default function SectionToggle({ title, sub, open, onToggle }) {
  return (
    <button
      type="button" className="zc-card-h" aria-expanded={open} onClick={onToggle}
      style={{
        width: "100%", background: "none", border: "none", font: "inherit", textAlign: "left", cursor: "pointer",
        borderBottom: open ? "1px solid var(--edge)" : "none",
      }}
    >
      <span className="t">{title}</span>
      {open && sub && <span className="s">{sub}</span>}
      <span aria-hidden="true" style={{ marginLeft: "auto", color: "var(--text-3)", transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
    </button>
  );
}
