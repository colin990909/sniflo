import { create } from "zustand";

export type AIRuntimeType = "claude_code_local" | "codex_local" | "remote_api";
export type RemoteAPIProtocol = "openai" | "anthropic";
export type RemoteAPIEndpointMode = "official" | "custom";

export interface ClaudeCodeLocalConfig {
  cliPath: string;
  model?: string;
  workingDirectory?: string;
  maxContextTokens?: number;
}

export interface CodexLocalConfig {
  cliPath: string;
  model?: string;
  workingDirectory?: string;
  approvalPolicy?: "never" | "on-failure" | "on-request";
  sandboxMode?: "danger-full-access" | "workspace-write" | "read-only";
  maxContextTokens?: number;
}

export interface RemoteAPIConfig {
  protocol: RemoteAPIProtocol;
  endpointMode?: RemoteAPIEndpointMode;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxContextTokens?: number;
}

export interface RuntimeHealthcheckResult {
  status: "passed" | "warning" | "failed";
  message: string;
}

export type AIRuntimeConfig = ClaudeCodeLocalConfig | CodexLocalConfig | RemoteAPIConfig;

export interface AIRuntimeEntry {
  id: string;
  name: string;
  runtimeType: AIRuntimeType;
  config: AIRuntimeConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  lastHealthcheck?: RuntimeHealthcheckResult | null;
}

interface RuntimeState {
  runtimes: AIRuntimeEntry[];
  selectedRuntimeId: string | null;

  selectedRuntime: () => AIRuntimeEntry | undefined;
  defaultRuntime: () => AIRuntimeEntry | undefined;

  add: (entry: AIRuntimeEntry) => void;
  update: (entry: AIRuntimeEntry) => void;
  remove: (id: string) => void;
  setDefault: (id: string) => void;
  select: (id: string | null) => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  runtimes: [],
  selectedRuntimeId: null,

  selectedRuntime: () => {
    const { runtimes, selectedRuntimeId } = get();
    return runtimes.find((runtime) => runtime.id === selectedRuntimeId);
  },

  defaultRuntime: () => get().runtimes.find((runtime) => runtime.isDefault),

  add: (entry) => {
    set((state) => ({
      runtimes: [...state.runtimes, entry],
      selectedRuntimeId: state.selectedRuntimeId ?? entry.id,
    }));
    void get().save();
  },

  update: (entry) => {
    set((state) => ({
      runtimes: state.runtimes.map((runtime) => (runtime.id === entry.id ? entry : runtime)),
    }));
    void get().save();
  },

  remove: (id) => {
    set((state) => ({
      runtimes: state.runtimes.filter((runtime) => runtime.id !== id),
      selectedRuntimeId: state.selectedRuntimeId === id ? null : state.selectedRuntimeId,
    }));
    void get().save();
  },

  setDefault: (id) => {
    set((state) => ({
      runtimes: state.runtimes.map((runtime) => ({
        ...runtime,
        isDefault: runtime.id === id,
      })),
    }));
    void get().save();
  },

  select: (id) => set({ selectedRuntimeId: id }),

  load: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const runtimes = await invoke<AIRuntimeEntry[]>("load_runtimes");
      const defaultRuntime = runtimes.find((runtime) => runtime.isDefault);
      set({
        runtimes,
        selectedRuntimeId: defaultRuntime?.id ?? runtimes[0]?.id ?? null,
      });
    } catch (error) {
      console.error("[runtime-store] load failed:", error);
    }
  },

  save: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_runtimes", { runtimes: get().runtimes });
    } catch (error) {
      console.error("[runtime-store] save failed:", error);
    }
  },
}));
