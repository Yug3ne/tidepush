import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth, setUnauthorizedHandler, type Admin, type AuthStatus } from "./api";

interface AuthState {
  /** null while the first /auth/status is in flight. */
  status: AuthStatus | null;
  /** Set when /auth/status itself failed (server down, etc.). */
  loadError: string | null;
  admin: Admin | null;
  refresh: () => Promise<void>;
  signedIn: (admin: Admin) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await auth.status());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 from /admin means the session is gone: drop to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setStatus((s) => (s ? { ...s, admin: null } : s)));
    return () => setUnauthorizedHandler(null);
  }, []);

  const signedIn = useCallback((admin: Admin) => setStatus({ needsSetup: false, admin }), []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setStatus((s) => ({ needsSetup: s?.needsSetup ?? false, admin: null }));
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, loadError, admin: status?.admin ?? null, refresh, signedIn, signOut }),
    [status, loadError, refresh, signedIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** The signed-in admin; only use inside routes guarded by RequireAuth. */
export function useAdmin(): Admin {
  const { admin } = useAuth();
  if (!admin) throw new Error("useAdmin without a session");
  return admin;
}
