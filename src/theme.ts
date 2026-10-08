import { useCallback, useLayoutEffect, useState } from "react";

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "seo-workspace.theme";
const THEME_CHANGE_EVENT = "seo-workspace-theme-change";
let sessionTheme: Theme | undefined;

function readTheme(): Theme {
  if (sessionTheme) return sessionTheme;
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Apply the saved choice before the first render. The existing light theme is the default. */
export function initializeTheme(): Theme {
  const theme = readTheme();
  applyRootTheme(theme);
  return theme;
}

function applyRootTheme(theme: Theme) {
  sessionTheme = theme;
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111318" : "#0a8479");
}

/** Theme preferences are independent of project data and work without network access. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useLayoutEffect(() => {
    applyRootTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // A browser may block preference storage; the current session still works.
    }
    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
  }, [theme]);

  useLayoutEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null)
        setTheme(event.newValue === "dark" ? "dark" : "light");
    };
    const onThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<Theme>).detail;
      if (nextTheme === "dark" || nextTheme === "light") setTheme(nextTheme);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme, setTheme };
}
