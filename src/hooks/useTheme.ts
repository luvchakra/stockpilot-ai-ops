import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "stockpilot.theme";

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(mode: ThemeMode) {
  return mode === "system" ? systemPrefersDark() : mode === "dark";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveIsDark(mode));
}

function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

// Light/dark/system mode, persisted to localStorage. __root.tsx applies the
// same resolution synchronously via an inline script before hydration, so
// there's no flash of the wrong theme on load; this hook just needs to stay
// in sync with it afterwards (and re-resolve if the OS theme changes while
// on "system").
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getStoredTheme);

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setModeState(next);
  }, []);

  return { mode, setMode };
}
