import { create } from "zustand";

export interface CertState {
  hasCA: boolean;
  isInstalled: boolean;
  caPath: string | null;
  isGenerating: boolean;
  isInstalling: boolean;
  error: string | null;

  checkStatus: () => Promise<void>;
  generateCA: () => Promise<void>;
  installCA: () => Promise<void>;
  showInFinder: () => Promise<void>;
}

interface CertStatusResponse {
  hasCa: boolean;
  isInstalled: boolean;
  caPath: string | null;
}

export const useCertStore = create<CertState>((set) => ({
  hasCA: false,
  isInstalled: false,
  caPath: null,
  isGenerating: false,
  isInstalling: false,
  error: null,

  checkStatus: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<CertStatusResponse>("get_cert_status");
      set({ hasCA: status.hasCa, isInstalled: status.isInstalled, caPath: status.caPath, error: null });
    } catch {
      // Not available yet
    }
  },

  generateCA: async () => {
    set({ isGenerating: true, error: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<CertStatusResponse>("generate_ca");
      set({
        hasCA: status.hasCa,
        isInstalled: status.isInstalled,
        caPath: status.caPath,
        isGenerating: false,
      });
    } catch (e) {
      set({ isGenerating: false, error: String(e) });
    }
  },

  installCA: async () => {
    set({ isInstalling: true, error: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_ca");
      // Refresh status to pick up isInstalled
      const status = await invoke<CertStatusResponse>("get_cert_status");
      set({
        hasCA: status.hasCa,
        isInstalled: status.isInstalled,
        caPath: status.caPath,
        isInstalling: false,
        error: null,
      });
    } catch (e) {
      set({ isInstalling: false, error: String(e) });
    }
  },

  showInFinder: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("show_cert_in_finder");
    } catch {
      // Ignore
    }
  },
}));
