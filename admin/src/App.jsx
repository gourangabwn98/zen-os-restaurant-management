// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { useAuth } from "./hooks/useAuth";

// import LoginPage from "./pages/auth/LoginPage";
import AdminLayout from "./pages/admin/AdminLayout";
import LoginPage from "./pages/LoginPage";
import KitchenDisplayPage from "./pages/KitchenDisplayPage";

function ProtectedAdmin({ children }) {
  const { user, isLoading } = useAuth();

  if (isLoading)
    return (
      <div style={{ padding: "100px", textAlign: "center" }}>Loading...</div>
    );

  if (!user) return <Navigate to="/login" replace />;

  // Optional: stricter admin check
  // if (user.role !== 'admin') return <Navigate to="/login" replace />;

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" />

      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/admin"
          element={
            <ProtectedAdmin>
              <AdminLayout />
            </ProtectedAdmin>
          }
        />

        {/* Full-screen kitchen ticket display — no sidebar, meant for a
            kitchen tablet left open all shift. Same login as Admin. */}
        <Route
          path="/kitchen"
          element={
            <ProtectedAdmin>
              <KitchenDisplayPage />
            </ProtectedAdmin>
          }
        />

        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
