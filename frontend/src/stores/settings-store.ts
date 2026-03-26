import { create } from "zustand";
import { normalizeThemePreference } from "@/lib/theme";

export interface AppSettings {
  language: string;
  theme: "light" | "dark";
  corsOverride: boolean;
  listenHost: string;
  listenPort: number;
  upstreamEnabled: boolean;
  upstreamHost: string;
  upstreamPort: number;
  autoStartProxy: boolean;
  maxSessions: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: "system",
  theme: "light",
  corsOverride: false,
  listenHost: "127.0.0.1",
  listenPort: 9090,
  upstreamEnabled: false,
  upstreamHost: "127.0.0.1",
  upstreamPort: 7890,
  autoStartProxy: false,
  maxSessions: 0,
};

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  save: () => Promise<void>;
  update: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,

  load: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const settings = await invoke<AppSettings & { theme: string }>("load_settings");
      const normalizedSettings: AppSettings = {
        ...settings,
        theme: normalizeThemePreference(settings.theme),
      };
      set({ settings: normalizedSettings, loaded: true });

      if (settings.theme !== normalizedSettings.theme) {
        await invoke("save_settings", { settings: normalizedSettings });
      }
    } catch {
      set({ loaded: true });
    }
  },

  save: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_settings", { settings: get().settings });
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  },

  update: (partial) => {
    const merged = { ...get().settings, ...partial };
    set({ settings: merged });
    get().save();
  },
}));
