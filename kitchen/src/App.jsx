import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AppStateProvider, useAppState } from "./context/AppState.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import KitchenBoardPage from "./pages/KitchenBoardPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";

function RequireAuth({ children }) {
  const { auth } = useAppState();
  if (!auth.isLoggedIn) return <Navigate to="/login" replace />;
  return children;
}

function Shell() {
  const { auth } = useAppState();
  return (
    <Routes>
      <Route path="/login" element={auth.isLoggedIn ? <Navigate to="/board" replace /> : <LoginPage />} />
      <Route path="/board" element={<RequireAuth><KitchenBoardPage /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="*" element={<Navigate to={auth.isLoggedIn ? "/board" : "/login"} replace />} />
    </Routes>
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
