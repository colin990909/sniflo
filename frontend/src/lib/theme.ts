import type { AppSettings } from "@/stores/settings-store";

export type ThemePreference = AppSettings["theme"];
export type ResolvedTheme = "light" | "dark";

export function normalizeThemePreference(theme: string): ThemePreference {
  return theme === "dark" ? "dark" : "light";
}

export function resolveThemePreference(theme: string): ResolvedTheme {
  return normalizeThemePreference(theme);
}

export function applyThemePreference(theme: string) {
  const resolved = resolveThemePreference(theme);
  document.documentElement.dataset.theme = resolved;
}
