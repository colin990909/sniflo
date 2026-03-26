import { create } from "zustand";

export interface BreakpointRule {
  id: string;
  host: string;
  path: string;
  method: string;
  phase: "request" | "response" | "both";
  enabled: boolean;
}

export interface PausedExchange {
  id: string;
  method: string;
  url: string;
  requestHeaders: [string, string][];
  requestBody: string;
  phase: "request" | "response";
  statusCode: number;
  responseHeaders: [string, string][];
  responseBody: string;
}

export type BreakpointAction = { type: "forward"; modified: PausedExchange } | { type: "drop" };

interface BreakpointState {
  isEnabled: boolean;
  rules: BreakpointRule[];
  currentExchange: PausedExchange | null;
  pendingCount: number;

  setEnabled: (enabled: boolean) => void;
  addRule: (rule: BreakpointRule) => void;
  removeRule: (id: string) => void;
  updateRule: (rule: BreakpointRule) => void;
  forward: (modified: PausedExchange) => Promise<void>;
  drop: (exchangeId: string) => Promise<void>;
  setCurrentExchange: (exchange: PausedExchange | null) => void;
  /** One-way sync from Rust backend — does NOT invoke back to Rust. */
  syncFromBackend: (enabled: boolean, rules: BreakpointRule[]) => void;
  /** Load persisted breakpoint config from SQLite on startup. */
  loadFromBackend: () => Promise<void>;
}

export const useBreakpointStore = create<BreakpointState>((set, get) => ({
  isEnabled: false,
  rules: [],
  currentExchange: null,
  pendingCount: 0,

  setEnabled: (enabled) => {
    set({ isEnabled: enabled });
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("set_breakpoint_enabled", { enabled }).catch(() => {});
    });
  },

  addRule: (rule) => {
    const rules = [...get().rules, rule];
    set({ rules });
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("set_breakpoint_rules", { rules }).catch(() => {});
    });
  },

  removeRule: (id) => {
    const rules = get().rules.filter((r) => r.id !== id);
    set({ rules });
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("set_breakpoint_rules", { rules }).catch(() => {});
    });
  },

  updateRule: (rule) => {
    const rules = get().rules.map((r) => (r.id === rule.id ? rule : r));
    set({ rules });
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("set_breakpoint_rules", { rules }).catch(() => {});
    });
  },

  forward: async (modified) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("breakpoint_forward", { exchangeId: modified.id, modified });
      set((s) => ({
        currentExchange: null,
        pendingCount: Math.max(0, s.pendingCount - 1),
      }));
    } catch {
      // Ignore
    }
  },

  drop: async (exchangeId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("breakpoint_drop", { exchangeId });
      set((s) => ({
        currentExchange: null,
        pendingCount: Math.max(0, s.pendingCount - 1),
      }));
    } catch {
      // Ignore
    }
  },

  setCurrentExchange: (exchange) =>
    set((s) => ({
      currentExchange: exchange,
      pendingCount: exchange ? s.pendingCount + 1 : s.pendingCount,
    })),

  syncFromBackend: (enabled, rules) => set({ isEnabled: enabled, rules }),

  /** Load persisted breakpoint config from SQLite via Tauri. */
  loadFromBackend: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [enabled, rules] = await invoke<[boolean, BreakpointRule[]]>("load_breakpoint_config");
      set({ isEnabled: enabled, rules });
    } catch {
      // Not in Tauri webview or command not available
    }
  },
}));
