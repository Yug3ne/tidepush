import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { adminApi, errorMessage, setCurrentApp, type AppInfo } from "./api";
import { Notice } from "./components/Notice";
import { Loading } from "./components/States";

interface AppsState {
  apps: AppInfo[];
  /** The selected app, or null when the org has none yet. */
  current: AppInfo | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
}

const AppsContext = createContext<AppsState | null>(null);
const STORAGE_KEY = "tidepush.app";

/**
 * Loads the org's apps and keeps the selected one in localStorage. App-level
 * API calls follow the selection (see setCurrentApp), and pages remount when
 * it changes, so they reload their data.
 */
export function AppsProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const reload = useCallback(async () => {
    try {
      setApps((await adminApi.apps()).apps.filter((a) => !a.archived));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = useMemo(
    () => (apps ? (apps.find((a) => a.id === selected) ?? apps[0] ?? null) : null),
    [apps, selected],
  );
  // Set synchronously during render, so children's first requests already use it.
  setCurrentApp(current?.id ?? null);

  const select = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setSelected(id);
  }, []);

  if (error && !apps) return <Notice tone="error">{error}</Notice>;
  if (!apps) return <Loading label="Loading apps…" />;
  return <AppsContext.Provider value={{ apps, current, select, reload }}>{children}</AppsContext.Provider>;
}

export function useApps(): AppsState {
  const ctx = useContext(AppsContext);
  if (!ctx) throw new Error("useApps outside AppsProvider");
  return ctx;
}
