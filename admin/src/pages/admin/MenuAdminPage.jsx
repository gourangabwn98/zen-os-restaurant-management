import { PRIMARY, PRIMARY_LIGHT, PRIMARY_MID, PRIMARY_DARK, GRADIENT_BTN } from "../../theme.js";
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import {
  getMenu,
  getCategories,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  createCategory,
  deleteCategory
  
} from "../../services/menuService.js";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PINK = PRIMARY;
const WHITE = "#1e1a2e";
const PINK_BG = "#fbeaf0";
const GREEN = "#1D9E75";

// ── Helpers ───────────────────────────────────────────────────────────────────
// Change normalizeCats to keep full objects:
const normalizeCats = (responseData) => {
  const list = responseData?.data || responseData || [];
  return list.filter(Boolean); // keep full {_id, name} objects
};

const Badge = ({ label, type }) => {
  const MAP = {
    Ready: { bg: "#EAF3DE", color: "#3B6D11" },
    Preparing: { bg: "#FAEEDA", color: "#854F0B" },
    Cancelled: { bg: "#FCEBEB", color: "#A32D2D" },
  };
  const s = MAP[type] || { bg: "#2a2540", color: "#9ca3af" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
};

const TAGS = ["Veg", "Non Veg"];
const EMPTY_FORM = {
  name: "",
  price: "",
  originalPrice: "",
  description: "",
  category: "",
  tag: "Veg",
  isAvailable: true,
  rating: 4.0,
};

// ── Image Upload Box ──────────────────────────────────────────────────────────
function ImageUploadBox({ label, currentUrl, file, onFileChange }) {
  const ref = useRef(null);
  const preview = file ? URL.createObjectURL(file) : currentUrl;

  return (
    <div>
      <label
        style={{
          fontSize: 12,
          color: "#9ca3af",
          display: "block",
          marginBottom: 5,
          fontWeight: 600,
        }}
      >
        {label}
      </label>
      <div
        onClick={() => ref.current.click()}
        style={{
          width: "100%",
          height: 110,
          borderRadius: 10,
          border: `2px dashed ${file || currentUrl ? PINK : "#ddd"}`,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: preview ? PINK_BG : "#252038",
          overflow: "hidden",
          position: "relative",
          transition: "border-color .2s",
        }}
      >
        {preview ? (
          <>
            <img
              src={preview}
              alt="preview"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 4,
                right: 4,
                background: "rgba(0,0,0,.5)",
                color: WHITE,
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              Change
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 26, marginBottom: 4 }}>📷</div>
            <div style={{ fontSize: 11, color: "#4b5563" }}>
              Click to upload image
            </div>
            <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>
              JPG, PNG, WEBP · max 5MB
            </div>
          </>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => onFileChange(e.target.files[0] || null)}
      />
      {file && (
        <button
          onClick={() => onFileChange(null)}
          style={{
            marginTop: 5,
            fontSize: 11,
            color: "#A32D2D",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Remove new image
        </button>
      )}
    </div>
  );
}

// ── Category Modal ────────────────────────────────────────────────────────────
function CategoryModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);
  const preview = file ? URL.createObjectURL(file) : null;

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error("Category name is required");
    try {
      setLoading(true);
      const fd = new FormData();
      fd.append("name", name.trim());
      if (file) fd.append("image", file);
      const { data } = await createCategory(fd);
      toast.success(`"${name}" category created!`);
      onSaved(data?.data || data);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to create category");
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    width: "100%",
    padding: "10px 13px",
    border: "1.5px solid #e8e8e8",
    borderRadius: 10,
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
    transition: "border .15s",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#1e1a2e",
          borderRadius: 20,
          width: "100%",
          maxWidth: 400,
          padding: 28,
          boxShadow: "0 24px 64px rgba(0,0,0,.18)",
          animation: "slideUp .2s cubic-bezier(.4,0,.2,1) both",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 22,
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#f1f0f5" }}>
              Create category
            </div>
            <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2 }}>
              Add a new menu category
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "1.5px solid #eee",
              background: "#1a1625",
              cursor: "pointer",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ca3af",
            }}
          >
            ✕
          </button>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              fontSize: 12,
              color: "#6b7280",
              fontWeight: 500,
              display: "block",
              marginBottom: 6,
            }}
          >
            Category name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Biryani, Burgers, Desserts…"
            style={inp}
            onFocus={(e) => (e.target.style.borderColor = PINK)}
            onBlur={(e) => (e.target.style.borderColor = "#e8e8e8")}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
          />
        </div>

        {/* Image upload */}
        <div style={{ marginBottom: 22 }}>
          <label
            style={{
              fontSize: 12,
              color: "#6b7280",
              fontWeight: 500,
              display: "block",
              marginBottom: 6,
            }}
          >
            Category image{" "}
            <span style={{ color: "#374151", fontWeight: 400 }}>(optional)</span>
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              width: "100%",
              height: 130,
              borderRadius: 12,
              border: `2px dashed ${file ? PINK : "#e8e8e8"}`,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: file ? PINK_BG : "#252038",
              overflow: "hidden",
              position: "relative",
              transition: "all .2s",
            }}
          >
            {preview ? (
              <>
                <img
                  src={preview}
                  alt="preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0,0,0,.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: WHITE,
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: 0,
                    transition: "opacity .2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = 0)}
                >
                  Click to change
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
                <div style={{ fontSize: 13, color: "#4b5563", fontWeight: 500 }}>
                  Click to upload image
                </div>
                <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>
                  JPG, PNG, WEBP · max 5 MB
                </div>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
          {file && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <span style={{ fontSize: 11, color: "#4b5563" }}>{file.name}</span>
              <button
                onClick={() => setFile(null)}
                style={{
                  fontSize: 11,
                  color: "#A32D2D",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "11px",
              border: "1.5px solid #eee",
              borderRadius: 12,
              background: "#1e1a2e",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
              color: "#9ca3af",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flex: 2,
              padding: "11px",
              border: "none",
              borderRadius: 12,
              background: loading ? "#374151" : PINK,
              color: WHITE,
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              boxShadow: loading ? "none" : "0 4px 14px rgba(233,30,140,.28)",
            }}
          >
            {loading ? "Creating…" : "Create category"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Category Select with inline "+ New category" button ──────────────────────
// function CategorySelect({ value, categories, onChange, onOpenCreateModal }) {
//   return (
//     <div>
//       <div
//         style={{
//           display: "flex",
//           justifyContent: "space-between",
//           alignItems: "center",
//           marginBottom: 5,
//         }}
//       >
//         <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>
//           Category *
//         </label>
//         <button
//           onClick={onOpenCreateModal}
//           style={{
//             fontSize: 11,
//             color: PINK,
//             background: PINK_BG,
//             border: `1px solid #f4c0d1`,
//             borderRadius: 20,
//             padding: "2px 10px",
//             cursor: "pointer",
//             fontWeight: 500,
//             display: "flex",
//             alignItems: "center",
//             gap: 4,
//           }}
//         >
//           + New category
//         </button>
//       </div>
//       <select
//         value={value}
//         onChange={(e) => onChange(e.target.value)}
//         style={{
//           width: "100%",
//           padding: "9px 12px",
//           border: "1px solid rgba(255,255,255,0.08)",
//           borderRadius: 8,
//           fontSize: 13,
//           outline: "none",
//           background: "#1e1a2e",
//           cursor: "pointer",
//           boxSizing: "border-box",
//         }}
//       >
//         {categories.length === 0 ? (
//           <option value="">No categories — create one first</option>
//         ) : (
//           categories.map((c) => (
//             <option key={c} value={c}>
//               {c}
//             </option>
//           ))
//         )}
//       </select>
//     </div>
//   );
// }
function CategorySelect({ value, categories, onChange, onOpenCreateModal, onDeleteCategory }) {
  const [confirmDelete, setConfirmDelete] = useState(null); // holds category name to delete

  const handleConfirmDelete = async () => {
    try {
      await onDeleteCategory(confirmDelete);
      toast.success(`"${confirmDelete?.name}" deleted`);
    } catch {
      toast.error("Failed to delete category");
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>Category *</label>
        <button
          onClick={onOpenCreateModal}
          style={{
            fontSize: 11, color: PINK, background: PINK_BG,
            border: `1px solid #f4c0d1`, borderRadius: 20,
            padding: "2px 10px", cursor: "pointer", fontWeight: 500,
          }}
        >
          + New category
        </button>
      </div>

      {/* List with delete buttons */}
      <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden", marginBottom: 6 }}>
        {categories.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 13, color: "#4b5563" }}>
            No categories — create one first
          </div>
        ) : (
          categories.map((c) => (
            <div
              key={c._id}                          // ← use _id as key
    onClick={() => onChange(c.name)} 
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 12px", cursor: "pointer", fontSize: 13,
                background: value === c.name ? PINK_BG : WHITE, 
                color: value === c ? PINK : "#e2e0ea",
                fontWeight: value === c ? 600 : 400,
                borderBottom: "1px solid #f5f5f5",
                transition: "background .15s",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                 {value === c.name && <span style={{ fontSize: 10 }}>●</span>}
      {c.name}      
              </span>
              <button
                 onClick={(e) => { e.stopPropagation(); setConfirmDelete(c); }} 
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#374151", fontSize: 14, padding: "0 4px",
                  lineHeight: 1, borderRadius: 4,
                  transition: "color .15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "#e53935"}
                onMouseLeave={(e) => e.currentTarget.style.color = "#374151"}
                title={`Delete "${c}"`}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Confirm delete popup */}
      {confirmDelete && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.5)",
          zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1e1a2e", borderRadius: 16, padding: 28, width: 360,
            boxShadow: "0 24px 64px rgba(0,0,0,.18)",
          }}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Delete category?</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 22 }}>
             Are you sure you want to delete <strong>"{confirmDelete?.name}"</strong>?
              Menu items in this category won't be deleted.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  flex: 1, padding: "11px", border: "1.5px solid #eee",
                  borderRadius: 10, background: "#1e1a2e", cursor: "pointer",
                  fontSize: 14, fontWeight: 500, color: "#9ca3af",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  flex: 1, padding: "11px", border: "none",
                  borderRadius: 10, background: "#e53935", color: WHITE,
                  cursor: "pointer", fontSize: 14, fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Item Modal ────────────────────────────────────────────────────────────────
function ItemModal({ item, categories, onClose, onSaved, onCategoryCreated }) {
  const isEdit = !!item?._id;
  const [form, setForm] = useState(
    isEdit
      ? { ...item, price: item.price, originalPrice: item.originalPrice || "" }
      : { ...EMPTY_FORM, category: categories[0] || "" },
  );
  const [imgFile, setImgFile] = useState(null);
  const [catFile, setCatFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));


  // Inside ItemModal, add this function:
const handleDeleteCategory = async (cat) => {
  // cat is a full object {_id, name} since normalizeCats now keeps full objects
  await deleteCategory(cat._id);
  onCategoryCreated({ name: cat.name, _deleted: true });
  if (form.category === cat.name) set("category", "");
};

// Then update the CategorySelect usage:
<CategorySelect
  value={form.category}
  categories={categories}
  onChange={(v) => set("category", v)}
  onOpenCreateModal={() => setShowCatModal(true)}
  onDeleteCategory={handleDeleteCategory}  // ← add this
/>
  // When a new category is created inside the nested modal
  const handleCategoryCreated = (newCat) => {
    const name = typeof newCat === "string" ? newCat : newCat?.name;
    if (!name) return;
    onCategoryCreated(newCat); // bubble up to page
    set("category", name); // auto-select the new category
    setShowCatModal(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.price) return toast.error("Price is required");
    if (isNaN(Number(form.price))) return toast.error("Price must be a number");
    if (!form.category) return toast.error("Category is required");

    try {
      setLoading(true);
      const fd = new FormData();
      fd.append("name", form.name.trim());
      fd.append("price", form.price);
      fd.append("category", form.category);
      fd.append("tag", form.tag);
      fd.append("isAvailable", form.isAvailable);
      fd.append("rating", form.rating || 4);
      if (form.originalPrice) fd.append("originalPrice", form.originalPrice);
      if (form.description) fd.append("description", form.description);
      if (imgFile) fd.append("image", imgFile);
      // else if (form.image) fd.append("image", form.image);
      if (catFile) fd.append("categoryImage", catFile);
      // else if (form.categoryImage)
      //   fd.append("categoryImage", form.categoryImage);

      let data;
      if (isEdit) {
        ({ data } = await updateMenuItem(item._id, fd));
        toast.success("Item updated!");
        onSaved(data, "edit");
      } else {
        ({ data } = await createMenuItem(fd));
        toast.success("Item created!");
        onSaved(data, "create");
      }
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to save item");
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };
  const lbl = {
    fontSize: 12,
    color: "#9ca3af",
    display: "block",
    marginBottom: 5,
    fontWeight: 600,
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.7)",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            background: "#1e1a2e",
            borderRadius: 16,
            padding: 28,
            width: "100%",
            maxWidth: 560,
            maxHeight: "92vh",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 22,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 17 }}>
              {isEdit ? "Edit menu item" : "Add new item"}
            </div>
            <button
              onClick={onClose}
              style={{
                background: "#2a2540",
                border: "none",
                borderRadius: "50%",
                width: 30,
                height: 30,
                cursor: "pointer",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <div style={{ gridColumn: "1/-1" }}>
              <label style={lbl}>Item name *</label>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Dunked Zinger Burger"
                style={inp}
              />
            </div>

            <div>
              <label style={lbl}>Price (₹) *</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="290"
                style={inp}
              />
            </div>

            <div>
              <label style={lbl}>Original price (₹)</label>
              <input
                type="number"
                value={form.originalPrice}
                onChange={(e) => set("originalPrice", e.target.value)}
                placeholder="440 (optional)"
                style={inp}
              />
            </div>

            {/* ── Category select with "+ New category" button ── */}
            <div style={{ gridColumn: "1/-1" }}>
           <CategorySelect
  value={form.category}
  categories={categories}
  onChange={(v) => set("category", v)}
  onOpenCreateModal={() => setShowCatModal(true)}
  onDeleteCategory={handleDeleteCategory}  // ← add this
/>
            </div>

            <div style={{ gridColumn: "1/-1" }}>
              <label style={lbl}>Tag *</label>
              <div style={{ display: "flex", gap: 8 }}>
                {TAGS.map((t) => (
                  <button
                    key={t}
                    onClick={() => set("tag", t)}
                    style={{
                      flex: 1,
                      padding: "9px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 13,
                      border:
                        form.tag === t ? `2px solid ${PINK}` : "1px solid rgba(255,255,255,0.08)",
                      background: form.tag === t ? PINK_BG : WHITE,
                      color: form.tag === t ? PINK : "#9ca3af",
                      fontWeight: form.tag === t ? 600 : 400,
                    }}
                  >
                    {t === "Veg" ? "🟢" : "🔴"} {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ gridColumn: "1/-1" }}>
              <label style={lbl}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Short description of the item…"
                rows={2}
                style={{ ...inp, resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            <ImageUploadBox
              label="Item image *"
              currentUrl={form.image}
              file={imgFile}
              onFileChange={setImgFile}
            />

            {/* <ImageUploadBox
              label="Category image"
              currentUrl={form.categoryImage}
              file={catFile}
              onFileChange={setCatFile}
            /> */}

            <div>
              <label style={lbl}>Rating (1–5)</label>
              <input
                type="number"
                min="1"
                max="5"
                step="0.1"
                value={form.rating}
                onChange={(e) => set("rating", e.target.value)}
                style={inp}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Available</label>
              <div
                onClick={() => set("isAvailable", !form.isAvailable)}
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  cursor: "pointer",
                  position: "relative",
                  background: form.isAvailable ? GREEN : "#ddd",
                  transition: "background .2s",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 3,
                    left: form.isAvailable ? 22 : 3,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "#1e1a2e",
                    transition: "left .2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {form.isAvailable ? "Yes" : "No"}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "#1a1625",
              borderRadius: 8,
              fontSize: 12,
              color: "#6b7280",
            }}
          >
            📷 Images uploaded to Cloudinary automatically. Max 5 MB. Square
            images recommended.
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: "11px",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 25,
                background: "#1e1a2e",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                flex: 2,
                padding: "11px",
                border: "none",
                borderRadius: 25,
                background: loading ? "#374151" : PINK,
                color: WHITE,
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {loading
                ? `⏳ ${isEdit ? "Updating…" : "Creating…"}`
                : isEdit
                  ? "Update item"
                  : "Create item"}
            </button>
          </div>
        </div>
      </div>

      {/* Nested category modal — z-index higher than item modal */}
      {showCatModal && (
        <div style={{ zIndex: 1100, position: "fixed", inset: 0 }}>
          <CategoryModal
            onClose={() => setShowCatModal(false)}
            onSaved={handleCategoryCreated}
          />
        </div>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MenuAdminPage() {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]); // string[]
  const [search, setSearch] = useState("");
  const [selCat, setSelCat] = useState("All");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  // Also allow creating category directly from the filter bar
  const [showCatModal, setShowCatModal] = useState(false);

  const loadCats = () =>
    getCategories().then((r) => setCats(normalizeCats(r.data)));

  useEffect(() => {
    Promise.all([getMenu({}), getCategories()])
      .then(([m, c]) => {
        setItems(m.data || []);
        setCats(normalizeCats(c.data));
        setLoading(false);
      })
      .catch(() => {
        toast.error("Failed to load menu");
        setLoading(false);
      });
  }, []);

  const handleSaved = (saved, mode) => {
    if (mode === "create") setItems((p) => [saved, ...p]);
    else setItems((p) => p.map((i) => (i._id === saved._id ? saved : i)));
    loadCats();
  };

  // Called when a new category is created from inside ItemModal OR the filter bar
  // const handleCategoryCreated = (newCat) => {
  //   const name = typeof newCat === "string" ? newCat : newCat?.name;
  //   if (name && !cats.includes(name)) {
  //     setCats((p) => [...p, name]);
  //   }
  // };
 const handleCategoryCreated = (newCat) => {
  if (newCat?._deleted) {
    setCats((p) => p.filter((c) => c.name !== newCat.name));  // ← compare by name
    return;
  }
  const exists = cats.some((c) => c.name === newCat?.name);
  if (!exists) setCats((p) => [...p, newCat]);
};
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this item? This cannot be undone.")) return;
    try {
      await deleteMenuItem(id);
      setItems((p) => p.filter((i) => i._id !== id));
      toast.success("Item deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const toggleAvail = async (item) => {
    try {
      const { data } = await updateMenuItem(item._id, {
        isAvailable: !item.isAvailable,
      });
      setItems((p) => p.map((i) => (i._id === data._id ? data : i)));
      toast.success(
        `${data.name} → ${data.isAvailable ? "Available" : "Hidden"}`,
      );
    } catch {
      toast.error("Update failed");
    }
  };

  const filtered = items.filter(
    (i) =>
      (selCat === "All" || i.category === selCat) &&
      i.name?.toLowerCase().includes(search.toLowerCase()),
  );

const allCats = ["All", ...cats.map((c) => c.name)];

  return (
    <>
      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 500 }}>Menu items</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
              Manage the café's food & beverage catalog
            </div>
          </div>
          <button
            onClick={() => setModal("create")}
            style={{
              background: PINK,
              color: WHITE,
              border: "none",
              borderRadius: 25,
              padding: "10px 22px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            + Add item
          </button>
        </div>
      </div>

      <div
        style={{
          background: "#1e1a2e",
          border: "0.5px solid #eee",
          borderRadius: 12,
          padding: 18,
        }}
      >
        {/* ── Filters ── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 18,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by item name…"
            style={{
              flex: 1,
              minWidth: 200,
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 13,
              outline: "none",
            }}
          />

          {/* Category filter dropdown */}
          <select
            value={selCat}
            onChange={(e) => setSelCat(e.target.value)}
            style={{
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 13,
              background: "#ddd",
              cursor: "pointer",
              minWidth: 160,
            }}
          >
            {allCats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* ── Create category button in filter bar ── */}
          <button
            onClick={() => setShowCatModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 16px",
              borderRadius: 8,
              border: `1.5px solid #f4c0d1`,
              background: PINK_BG,
              color: PINK,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            + New category
          </button>
        </div>

        {/* ── Stats ── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          {[
            {
              label: "Total items",
              val: items.length,
              color: "#185FA5",
              bg: "#E6F1FB",
            },
            {
              label: "Available",
              val: items.filter((i) => i.isAvailable).length,
              color: "#3B6D11",
              bg: "#EAF3DE",
            },
            {
              label: "Hidden",
              val: items.filter((i) => !i.isAvailable).length,
              color: "#A32D2D",
              bg: "#FCEBEB",
            },
            {
              label: "Veg items",
              val: items.filter((i) => i.tag === "Veg").length,
              color: "#3B6D11",
              bg: "#EAF3DE",
            },
            {
              label: "Non-veg items",
              val: items.filter((i) => i.tag === "Non Veg").length,
              color: "#854F0B",
              bg: "#FAEEDA",
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: s.bg,
                borderRadius: 8,
                padding: "8px 14px",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 700, color: s.color }}>
                {s.val}
              </span>
              <span style={{ fontSize: 11, color: s.color }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div
            style={{ textAlign: "center", padding: "48px 0", color: "#4b5563" }}
          >
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{ textAlign: "center", padding: "48px 20px", color: "#4b5563" }}
          >
            <div style={{ fontSize: 30, marginBottom: 8 }}>📭</div>
            <div>No items match your filters</div>
          </div>
        ) : (
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
                    "Item",
                    "Category",
                    "Price",
                    "Tag",
                    "Rating",
                    "Available",
                    "Actions",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        color: "#6b7280",
                        fontSize: 11,
                        fontWeight: 500,
                        borderBottom: "0.5px solid #eee",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item._id}
                    style={{ borderBottom: "0.5px solid #f5f5f5" }}
                  >
                    <td style={{ padding: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        {item.image?.startsWith("http") ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 10,
                              objectFit: "cover",
                              background: "#252038",
                              flexShrink: 0,
                            }}
                            onError={(e) => {
                              e.target.style.display = "none";
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 10,
                              background: "#252038",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 28,
                              flexShrink: 0,
                            }}
                          >
                            🍽️
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 500 }}>{item.name}</div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#4b5563",
                              marginTop: 1,
                            }}
                          >
                            {item.description?.slice(0, 40)}
                            {item.description?.length > 40 ? "…" : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span
                        style={{
                          background: "#252038",
                          padding: "3px 10px",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      >
                        {item.category}
                      </span>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div style={{ fontWeight: 600 }}>₹{item.price}</div>
                      {item.originalPrice && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#4b5563",
                            textDecoration: "line-through",
                          }}
                        >
                          ₹{item.originalPrice}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <Badge
                        label={item.tag || "—"}
                        type={item.tag === "Veg" ? "Ready" : "Preparing"}
                      />
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        color: "#BA7517",
                        fontWeight: 500,
                      }}
                    >
                      ★ {item.rating?.toFixed(1)}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div
                        onClick={() => toggleAvail(item)}
                        title="Click to toggle"
                        style={{
                          width: 40,
                          height: 22,
                          borderRadius: 11,
                          cursor: "pointer",
                          position: "relative",
                          background: item.isAvailable ? GREEN : "#ddd",
                          transition: "background .2s",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: 2,
                            left: item.isAvailable ? 20 : 2,
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: "#1e1a2e",
                            transition: "left .2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => setModal(item)}
                          style={{
                            padding: "5px 12px",
                            borderRadius: 8,
                            border: "0.5px solid #ddd",
                            background: "#ddd",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(item._id)}
                          style={{
                            padding: "5px 12px",
                            borderRadius: 8,
                            border: "0.5px solid #f9a8a8",
                            background: "#1e1a2e",
                            color: "#A32D2D",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 500,
                          }}
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
        )}
      </div>

      {/* ── Item Modal ── */}
      {modal && (
        <ItemModal
          item={modal === "create" ? null : modal}
          categories={cats}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onCategoryCreated={handleCategoryCreated}
        />
      )}

      {/* ── Standalone Category Modal (from filter bar) ── */}
      {showCatModal && (
        <CategoryModal
          onClose={() => setShowCatModal(false)}
          onSaved={(newCat) => {
            handleCategoryCreated(newCat);
            setShowCatModal(false);
          }}
        />
      )}
    </>
  );
}
