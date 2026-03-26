import { create } from "zustand";

export interface SessionDetail {
  method: string;
  url: string;
  statusCode: number | null;
  requestHeaders: [string, string][];
  requestBody: string;
  requestBodyEncoding?: "utf8" | "base64";
  responseHeaders: [string, string][];
  responseBody: string;
  responseBodyEncoding?: "utf8" | "base64";
  timestamp: string;
  contentType?: string;
}

export interface SessionItem {
  id: string;
  title: string;
  host: string;
  detail: SessionDetail | null;
}

interface AppState {
  sessions: SessionItem[];
  selectedSessionIds: Set<string>;
  anchorSessionId: string | null;
  statusMessage: string | null;

  prependSession: (session: SessionItem) => void;
  clearSessions: () => void;
  setSessionSelection: (selected: Set<string>, anchor: string | null) => void;
  removeSelectedSession: (sessionId: string) => void;
  setStatusMessage: (msg: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  selectedSessionIds: new Set<string>(),
  anchorSessionId: null,
  statusMessage: null,

  prependSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)],
      anchorSessionId: state.anchorSessionId ?? session.id,
      selectedSessionIds: state.anchorSessionId ? state.selectedSessionIds : new Set([session.id]),
    })),

  clearSessions: () => {
    set({ sessions: [], selectedSessionIds: new Set<string>(), anchorSessionId: null });
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("clear_sessions").catch(() => {});
      })
      .catch(() => {});
  },

  setSessionSelection: (selected, anchor) =>
    set({ selectedSessionIds: selected, anchorSessionId: anchor }),

  removeSelectedSession: (sessionId) =>
    set((state) => {
      if (!state.selectedSessionIds.has(sessionId)) {
        return state;
      }

      const selectedSessionIds = new Set(state.selectedSessionIds);
      selectedSessionIds.delete(sessionId);

      const anchorSessionId = selectedSessionIds.size === 0
        ? null
        : (state.anchorSessionId && selectedSessionIds.has(state.anchorSessionId)
          ? state.anchorSessionId
          : state.sessions.find((session) => selectedSessionIds.has(session.id))?.id ?? null);

      return { selectedSessionIds, anchorSessionId };
    }),

  setStatusMessage: (msg) =>
    set({ statusMessage: msg }),
}));
