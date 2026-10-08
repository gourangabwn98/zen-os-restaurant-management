// src/App.jsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { useAuth } from "./hooks/useAuth";
import { useLang } from "./hooks/useLang.js";
import { isManager } from "./utils/access.js";
//test

// import LoginPage from "./pages/auth/LoginPage";
import AdminLayout from "./pages/admin/AdminLayout";
// Login pulls in the Firebase SDK (~half the old bundle) and the Kitchen
// Display is a separate tablet screen — neither is needed to open the admin,
// so both load as their own chunks.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const KitchenDisplayPage = lazy(() => import("./pages/KitchenDisplayPage"));
const RouteFallback = () => <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><div className="zc-spin" /></div>;

function ProtectedAdmin({ children, adminOnly = false }) {
  const { user, isLoading } = useAuth();

  if (isLoading)
    return (
      <div style={{ padding: "100px", textAlign: "center" }}>Loading...</div>
    );

  if (!user) return <Navigate to="/login" replace />;
  // A manager has the admin app without the admin-only screens (utils/access.js).
  if (adminOnly && isManager(user)) return <Navigate to="/admin" replace />;

  // Optional: stricter admin check
  // if (user.role !== 'admin') return <Navigate to="/login" replace />;

  return children;
}

export default function App() {
  // GLB-04: subscribing here re-renders every screen in the new language
  // without unmounting anything (forms, route, open orders stay as they are).
  useLang();
  return (
    <BrowserRouter>
      <Toaster position="top-center" />

      <Suspense fallback={<RouteFallback />}>
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
            <ProtectedAdmin adminOnly>
              <KitchenDisplayPage />
            </ProtectedAdmin>
          }
        />

        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
