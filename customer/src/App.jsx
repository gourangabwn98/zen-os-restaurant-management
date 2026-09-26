import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";
import { AppStateProvider, useAppState } from "./context/AppState.jsx";
import { enablePushNotifications, isPushEnabled, onForegroundMessage } from "./services/notificationService.js";
import Topbar from "./components/Topbar.jsx";
import BottomNav from "./components/BottomNav.jsx";
import CartBar from "./components/CartBar.jsx";
import HomePage from "./pages/HomePage.jsx";
import MenuPage from "./pages/MenuPage.jsx";
import OffersPage from "./pages/OffersPage.jsx";
import CartPage from "./pages/CartPage.jsx";
import OrdersPage from "./pages/OrdersPage.jsx";
import OrderDetailPage from "./pages/OrderDetailPage.jsx";
import HelpPage from "./pages/HelpPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import FavoritesPage from "./pages/FavoritesPage.jsx";

const NO_CHROME_ROUTES = ["/login"];
// Browsing screens show the floating "View cart" bar (as in the reference).
const CART_BAR_ROUTES = ["/", "/menu", "/offers", "/favorites", "/profile"];

function Shell({ children }) {
  const { pathname } = useLocation();
  const { auth, cart } = useAppState();
  const chrome = !NO_CHROME_ROUTES.includes(pathname);
  const showCartBar = chrome && cart.itemCount > 0 && CART_BAR_ROUTES.includes(pathname);

  // Refreshes a rotated FCM token silently for a customer who already
  // opted in on a previous visit — no re-prompt, no UI. Also surfaces a
  // toast for any offer that arrives while the app is open in the
  // foreground (a closed/background tab gets an OS notification instead,
  // via public/firebase-messaging-sw.js).
  useEffect(() => {
    if (auth.isLoggedIn && isPushEnabled()) enablePushNotifications();

    let unsubscribe = () => {};
    onForegroundMessage(({ title, body }) => toast(`${title || "New offer"}${body ? ` — ${body}` : ""}`))
      .then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, [auth.isLoggedIn]);

  // New screen starts at the top (tab switches, order placed → tracking).
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  if (!chrome) return <div className="app">{children}</div>;

  return (
    <div className={`app${showCartBar ? " has-cart" : ""}`}>
      <Topbar />
      <main className="view" key={pathname}>{children}</main>
      {showCartBar && <CartBar />}
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 2500,
            style: {
              fontFamily: "var(--font)", fontSize: 14, fontWeight: 650, borderRadius: 999,
              background: "var(--text)", color: "var(--bg)", padding: "10px 16px", boxShadow: "var(--sh-2)",
            },
            success: { iconTheme: { primary: "#1F9D55", secondary: "#fff" } },
            error:   { iconTheme: { primary: "#E1460E", secondary: "#fff" } },
          }}
        />
        <Shell>
          <Routes>
            <Route path="/"          element={<HomePage />} />
            <Route path="/menu"      element={<MenuPage />} />
            <Route path="/offers"    element={<OffersPage />} />
            <Route path="/cart"      element={<CartPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
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
