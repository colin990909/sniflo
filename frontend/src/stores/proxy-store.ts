import { create } from "zustand";
import type { AppSettings } from "./settings-store";

export type ProxyStatus = "stopped" | "starting" | "running" | "failed";

const STARTUP_TIMEOUT_MS = 15_000;

interface ProxyState {
  status: ProxyStatus;
  lastError: string | null;
  listenHost: string;
  listenPort: string;
  upstreamEnabled: boolean;
  upstreamHost: string;
  upstreamPort: string;
  corsOverrideEnabled: boolean;
  listenAddress: string;
  _abortController: AbortController | null;

  hydrateFromSettings: (settings: AppSettings) => void;
  setListenHost: (host: string) => void;
  setListenPort: (port: string) => void;
  setUpstreamEnabled: (enabled: boolean) => void;
  setUpstreamHost: (host: string) => void;
  setUpstreamPort: (port: string) => void;
  setCorsOverrideEnabled: (enabled: boolean) => void;
  startProxy: () => Promise<void>;
  stopProxy: () => Promise<void>;
}

function persistToSettings(partial: Partial<AppSettings>) {
  import("./settings-store").then(({ useSettingsStore }) => {
    useSettingsStore.getState().update(partial);
  });
}

function invokeWithTimeout(
  invokeFn: (cmd: string, args: Record<string, unknown>) => Promise<void>,
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Proxy startup timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
    invokeFn(cmd, args)
      .then(() => { clearTimeout(timer); resolve(); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

export const useProxyStore = create<ProxyState>((set, get) => ({
  status: "stopped",
  lastError: null,
  listenHost: "127.0.0.1",
  listenPort: "9090",
  upstreamEnabled: false,
  upstreamHost: "127.0.0.1",
  upstreamPort: "7890",
  corsOverrideEnabled: false,
  _abortController: null,

  get listenAddress() {
    return `http://${get().listenHost}:${get().listenPort}`;
  },

  hydrateFromSettings: (settings) => set({
    listenHost: settings.listenHost,
    listenPort: String(settings.listenPort),
    upstreamEnabled: settings.upstreamEnabled,
    upstreamHost: settings.upstreamHost,
    upstreamPort: String(settings.upstreamPort),
    corsOverrideEnabled: settings.corsOverride,
  }),

  setListenHost: (host) => {
    set({ listenHost: host });
    persistToSettings({ listenHost: host });
  },
  setListenPort: (port) => {
    set({ listenPort: port });
    const parsed = parseInt(port);
    if (!isNaN(parsed)) persistToSettings({ listenPort: parsed });
  },
  setUpstreamEnabled: (enabled) => {
    set({ upstreamEnabled: enabled });
    persistToSettings({ upstreamEnabled: enabled });
  },
  setUpstreamHost: (host) => {
    set({ upstreamHost: host });
    persistToSettings({ upstreamHost: host });
  },
  setUpstreamPort: (port) => {
    set({ upstreamPort: port });
    const parsed = parseInt(port);
    if (!isNaN(parsed)) persistToSettings({ upstreamPort: parsed });
  },
  setCorsOverrideEnabled: (enabled) => {
    set({ corsOverrideEnabled: enabled });
    persistToSettings({ corsOverride: enabled });
  },

  startProxy: async () => {
    const currentStatus = get().status;
    if (currentStatus === "starting" || currentStatus === "running") return;

    const abortController = new AbortController();
    set({ status: "starting", lastError: null, _abortController: abortController });

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      if (abortController.signal.aborted) return;

      const state = get();
      const upstream = state.upstreamEnabled
        ? { host: state.upstreamHost, port: parseInt(state.upstreamPort) }
        : null;

      await invokeWithTimeout(invoke, "start_proxy", {
        host: state.listenHost,
        port: parseInt(state.listenPort),
        upstream,
        corsOverride: state.corsOverrideEnabled,
      }, STARTUP_TIMEOUT_MS);

      if (!abortController.signal.aborted) {
        set({
          status: "running",
          lastError: null,
          listenAddress: `http://${state.listenHost}:${state.listenPort}`,
          _abortController: null,
        });
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        set({
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          _abortController: null,
        });
      }
    }
  },

  stopProxy: async () => {
    const { _abortController } = get();

    // If still starting, abort the pending start and reset to stopped
    if (_abortController) {
      _abortController.abort();
      set({ status: "stopped", lastError: null, _abortController: null });
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_proxy");
      set({ status: "stopped", lastError: null });
    } catch {
      // Ignore stop errors — proxy may not have started yet
      set({ status: "stopped", lastError: null });
    }
  },
}));
