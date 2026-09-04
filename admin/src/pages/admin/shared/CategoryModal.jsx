import { useState } from "react";
import toast from "react-hot-toast";
import { createCategory } from "../../../services/menuService";
// import { createCategory } from "../../services/menuService";

export default function CategoryModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error("Category name required");

    try {
      setLoading(true);

      const fd = new FormData();
      fd.append("name", name);
      if (file) fd.append("image", file);

      const { data } = await createCategory(fd);

      toast.success("Category created!");
      onSaved(data.data);
      onClose();
    } catch {
      toast.error("Failed to create category");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#1e1a2e",
          padding: 20,
          borderRadius: 10,
          width: 320,
        }}
      >
        <h3>Add Category</h3>

        <input
          placeholder="Category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: "100%", marginBottom: 10, padding: 8 }}
        />

        <input type="file" onChange={(e) => setFile(e.target.files[0])} />

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
