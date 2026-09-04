import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AppStateProvider, useAppState } from "./context/AppState.jsx";
import { useOrderNotifications } from "./hooks/useOrderNotifications.js";
import BottomNav from "./components/BottomNav.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import TablesPage from "./pages/TablesPage.jsx";
import OrdersPage from "./pages/OrdersPage.jsx";
import NewOrderPage from "./pages/NewOrderPage.jsx";
import OrderDetailPage from "./pages/OrderDetailPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import { BG } from "./theme.js";

function RequireAuth({ children }) {
  const { auth } = useAppState();
  if (!auth.isLoggedIn) return <Navigate to="/login" replace />;
  return children;
}

function Shell() {
  const { pathname } = useLocation();
  const { auth } = useAppState();
  useOrderNotifications(auth.isLoggedIn);
  const showNav = auth.isLoggedIn && pathname !== "/login";

  return (
    <div style={{ minHeight: "100vh", background: BG, maxWidth: 560, margin: "0 auto", position: "relative" }}>
      <Routes>
        <Route path="/login" element={auth.isLoggedIn ? <Navigate to="/tables" replace /> : <LoginPage />} />
        <Route path="/tables" element={<RequireAuth><TablesPage /></RequireAuth>} />
        <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
        <Route path="/new-order" element={<RequireAuth><NewOrderPage /></RequireAuth>} />
        <Route path="/order/:id" element={<RequireAuth><OrderDetailPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="*" element={<Navigate to={auth.isLoggedIn ? "/tables" : "/login"} replace />} />
      </Routes>
      {showNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Toaster position="top-center" toastOptions={{ style: { fontFamily: "'DM Sans',sans-serif", fontSize: 14 }, duration: 2500 }} />
        <Shell />
      </BrowserRouter>
    </AppStateProvider>
  );
}
