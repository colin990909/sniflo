import { create } from "zustand";
import { isNewerVersion } from "@/lib/semver";

export interface ReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
}

export interface UpdateState {
  currentVersion: string;
  latestRelease: ReleaseInfo | null;
  hasUpdate: boolean;
  checking: boolean;
  error: string | null;
  lastChecked: number | null;

  initialize: () => Promise<void>;
  checkForUpdate: (silent?: boolean) => Promise<void>;
  dismissUpdate: () => void;
}

const CHECK_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

export const useUpdateStore = create<UpdateState>((set, get) => ({
  currentVersion: "",
  latestRelease: null,
  hasUpdate: false,
  checking: false,
  error: null,
  lastChecked: null,

  initialize: async () => {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      const version = await getVersion();
      set({ currentVersion: version });
    } catch {
      // Not in Tauri environment (browser dev mode)
      set({ currentVersion: "0.0.0-dev" });
    }
  },

  checkForUpdate: async (silent = false) => {
    const { lastChecked, checking } = get();
    if (checking) return;

    // Debounce: skip if checked within the last 5 minutes
    if (lastChecked && Date.now() - lastChecked < CHECK_DEBOUNCE_MS) {
      return;
    }

    set({ checking: true, error: null });

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const release = await invoke<ReleaseInfo>("check_for_update");

      const currentVersion = get().currentVersion;
      const hasUpdate = isNewerVersion(currentVersion, release.tagName);

      set({
        latestRelease: release,
        hasUpdate,
        checking: false,
        lastChecked: Date.now(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      set({
        checking: false,
        error: silent ? null : errorMessage,
        lastChecked: Date.now(),
      });
    }
  },

  dismissUpdate: () => {
    set({ hasUpdate: false });
  },
}));
