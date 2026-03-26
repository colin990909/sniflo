import { create } from "zustand";

export interface ScriptRule {
  id: string;
  name: string;
  urlPattern: string;
  phase: "request" | "response" | "both";
  priority: number;
  enabled: boolean;
  code: string;
  sourcePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptExecutionLog {
  scriptId: string;
  scriptName: string;
  url: string;
  phase: string;
  success: boolean;
  errorMessage?: string;
  durationMs: number;
  logs: string[];
}

const MAX_LOGS = 200;

interface ScriptState {
  scripts: ScriptRule[];
  selectedScriptId: string | null;
  recentLogs: ScriptExecutionLog[];
  isLoading: boolean;
  isEnabled: boolean;

  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  create: (name: string) => Promise<void>;
  update: (script: ScriptRule) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  select: (id: string | null) => void;
  importFile: () => Promise<void>;
  testScript: (code: string, phase: string) => Promise<string>;
  appendLogs: (logs: ScriptExecutionLog[]) => void;
  /** One-way sync from Rust backend — does NOT invoke back to Rust. */
  syncFromBackend: (scripts: ScriptRule[], enabled?: boolean) => void;
}

export const useScriptStore = create<ScriptState>((set, get) => ({
  scripts: [],
  selectedScriptId: null,
  recentLogs: [],
  isLoading: false,
  isEnabled: false,

  load: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [isEnabled, scripts] =
        await invoke<[boolean, ScriptRule[]]>("load_script_config");
      set({ isEnabled, scripts });
    } catch {
      // Not in Tauri webview
    }
  },

  setEnabled: (enabled) => {
    set({ isEnabled: enabled });
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("set_script_enabled", { enabled }).catch(() => {});
    });
  },

  create: async (name) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const now = String(Math.floor(Date.now() / 1000));
      const script: ScriptRule = {
        id: crypto.randomUUID(),
        name,
        urlPattern: "*",
        phase: "both",
        priority: get().scripts.length,
        enabled: false,
        code: 'function onRequest(ctx) {\n  // ctx.request.method, url, headers, body\n  // ctx.request.setHeader("name", "value")\n  // ctx.request.removeHeader("name")\n  // ctx.request.setBody("new body")\n  // ctx.log("debug message")\n  // return "drop" to discard\n}\n\nfunction onResponse(ctx) {\n  // ctx.response.status, headers, body\n  // ctx.response.setStatus(200)\n  // ctx.response.setHeader("name", "value")\n  // ctx.response.removeHeader("name")\n  // ctx.response.setBody("new body")\n}\n',
        createdAt: now,
        updatedAt: now,
      };
      await invoke("create_script", { script });
      const scripts = await invoke<ScriptRule[]>("list_scripts");
      set({ scripts, selectedScriptId: script.id });
    } catch {
      // Ignore
    }
  },

  update: async (script) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_script", { script: { ...script, updatedAt: String(Math.floor(Date.now() / 1000)) } });
      const scripts = await invoke<ScriptRule[]>("list_scripts");
      set({ scripts });
    } catch {
      // Ignore
    }
  },

  remove: async (id) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_script", { id });
      const scripts = await invoke<ScriptRule[]>("list_scripts");
      set((s) => ({
        scripts,
        selectedScriptId: s.selectedScriptId === id ? null : s.selectedScriptId,
      }));
    } catch {
      // Ignore
    }
  },

  toggle: async (id, enabled) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("toggle_script", { id, enabled });
      const scripts = await invoke<ScriptRule[]>("list_scripts");
      set({ scripts });
    } catch {
      // Ignore
    }
  },

  reorder: async (ids) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reorder_scripts", { ids });
      const scripts = await invoke<ScriptRule[]>("list_scripts");
      set({ scripts });
    } catch {
      // Ignore
    }
  },

  select: (id) => set({ selectedScriptId: id }),

  importFile: async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      // Use Tauri dialog to select file
      const { invoke } = await import("@tauri-apps/api/core");
      // For now, prompt user to provide path via other means
      // TODO: integrate @tauri-apps/plugin-dialog when available
      void open;
      void invoke;
    } catch {
      // Ignore
    }
  },

  testScript: async (code, phase) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const requestJson = JSON.stringify({
        method: "GET",
        url: "https://example.com/test",
        headers: [["Host", "example.com"], ["Accept", "*/*"]],
        body: "",
      });
      return await invoke<string>("test_script", { code, phase, requestJson });
    } catch (e) {
      return String(e);
    }
  },

  appendLogs: (logs) => {
    set((s) => ({
      recentLogs: [...logs, ...s.recentLogs].slice(0, MAX_LOGS),
    }));
  },

  syncFromBackend: (scripts, enabled) =>
    set((state) => ({
      scripts,
      isEnabled: enabled ?? state.isEnabled,
    })),
}));
