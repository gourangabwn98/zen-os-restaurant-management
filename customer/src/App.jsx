import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AppStateProvider } from "./context/AppState.jsx";
import BottomNav from "./components/BottomNav.jsx";
import HomePage from "./pages/HomePage.jsx";
import CartPage from "./pages/CartPage.jsx";
import OrdersPage from "./pages/OrdersPage.jsx";
import OrderDetailPage from "./pages/OrderDetailPage.jsx";
import HelpPage from "./pages/HelpPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { BG } from "./theme.js";

const NO_NAV_ROUTES = ["/login"];

function Shell({ children }) {
  const { pathname } = useLocation();
  const showNav = !NO_NAV_ROUTES.includes(pathname);

  return (
    <div style={{ minHeight: "100vh", background: BG, maxWidth: 560, margin: "0 auto", position: "relative" }}>
      {children}
      {showNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Toaster
          position="top-center"
          toastOptions={{ style: { fontFamily: "'DM Sans',sans-serif", fontSize: 14 }, duration: 2500 }}
        />
        <Shell>
          <Routes>
            <Route path="/"          element={<HomePage />} />
            <Route path="/cart"      element={<CartPage />} />
            <Route path="/orders"    element={<OrdersPage />} />
            <Route path="/order/:id" element={<OrderDetailPage />} />
            <Route path="/help"      element={<HelpPage />} />
            <Route path="/profile"   element={<ProfilePage />} />
            <Route path="/login"     element={<LoginPage />} />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </AppStateProvider>
  );
}
