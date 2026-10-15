import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./auth";
import { AppShell } from "./components/AppShell";
import { AuthLayout } from "./components/AuthLayout";
import { Loading } from "./components/States";
import { ToastProvider } from "./components/Toast";
import { AuditPage } from "./pages/Audit";
import { DevicesPage } from "./pages/Devices";
import { InvitePage } from "./pages/Invite";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { SetupPage } from "./pages/Setup";
import { UpdatesPage } from "./pages/Updates";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Gate>
            <Routes>
              <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
              <Route path="/setup" element={<SetupOnly />} />
              <Route path="/invite/:token" element={<InvitePage />} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<UpdatesPage />} />
                <Route path="devices" element={<DevicesPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Gate>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

/** Waits for the first GET /auth/status before rendering any route. */
function Gate({ children }: { children: ReactNode }) {
  const { status, loadError, refresh } = useAuth();
  if (status) return <>{children}</>;
  if (loadError)
    return (
      <AuthLayout>
        <h1>Can't reach Tidepush</h1>
        <p className="lede">{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
          Try again
        </button>
      </AuthLayout>
    );
  return <Loading label="Loading Tidepush…" />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status?.admin) return <>{children}</>;
  if (status?.needsSetup) return <Navigate to="/setup" replace />;
  const from = location.pathname + location.search + location.hash;
  return <Navigate to="/login" replace state={from !== "/" ? { from } : undefined} />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status?.needsSetup) return <Navigate to="/setup" replace />;
  if (status?.admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SetupOnly() {
  const { status } = useAuth();
  if (!status?.needsSetup) return <Navigate to={status?.admin ? "/" : "/login"} replace />;
  return <SetupPage />;
}
