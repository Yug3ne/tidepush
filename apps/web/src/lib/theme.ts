import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "tidepush.theme";

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** "system" removes the override so prefers-color-scheme applies (see public/theme-init.js). */
export function applyThemePreference(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

export function useThemePreference() {
  // Start from "system" so server and client render the same markup, then read the saved choice.
  const [pref, setPref] = useState<ThemePreference>("system");
  useEffect(() => setPref(getThemePreference()), []);
  useEffect(() => {
    // Keep several open tabs in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        const next = getThemePreference();
        applyThemePreference(next);
        setPref(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const set = useCallback((p: ThemePreference) => {
    applyThemePreference(p);
    setPref(p);
  }, []);
  return [pref, set] as const;
}
