import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore, type SessionDetail } from "@/stores/app-store";
import { useAIStore } from "@/stores/ai-store";
import { useBreakpointStore, type PausedExchange, type BreakpointRule } from "@/stores/breakpoint-store";
import { useScriptStore, type ScriptExecutionLog, type ScriptRule } from "@/stores/script-store";

/** Shape emitted by Rust `app_handle.emit("proxy:capture", &session)`. */
interface CapturedSession {
  id: string;
  method: string;
  url: string;
  host: string;
  statusCode: number;
  requestHeaders: [string, string][];
  requestBody: string;
  requestBodyEncoding?: "utf8" | "base64";
  responseHeaders: [string, string][];
  responseBody: string;
  responseBodyEncoding?: "utf8" | "base64";
  protocol: string;
  timestamp: string;
}

/** Shape emitted by Rust `app_handle.emit("ai:agent_event", &event)`. */
interface AgentEvent {
  type: "stream_delta" | "thinking_delta" | "tool_call" | "tool_result" | "iteration" | "agent_done" | "error";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  current?: number;
  max?: number;
  final_text?: string;
  message?: string;
}

function capturedToSessionItem(c: CapturedSession) {
  const contentType = c.responseHeaders.find(
    ([k]) => k.toLowerCase() === "content-type",
  )?.[1];

  const detail: SessionDetail = {
    method: c.method,
    url: c.url,
    statusCode: c.statusCode,
    requestHeaders: c.requestHeaders,
    requestBody: c.requestBody,
    requestBodyEncoding: c.requestBodyEncoding,
    responseHeaders: c.responseHeaders,
    responseBody: c.responseBody,
    responseBodyEncoding: c.responseBodyEncoding,
    timestamp: c.timestamp,
    contentType,
  };

  return {
    id: c.id,
    title: c.url,
    host: c.host,
    detail,
  };
}

let pendingDelta = "";
let deltaRafId: number | null = null;

function flushDelta() {
  deltaRafId = null;
  if (!pendingDelta) return;
  const store = useAIStore.getState();
  const msgs = store.messages;
  let lastAssistant: typeof msgs[number] | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") { lastAssistant = msgs[i]; break; }
  }
  if (lastAssistant) {
    store.updateLastAssistantMessage((lastAssistant.content || "") + pendingDelta);
  }
  pendingDelta = "";
}

function handleAgentEvent(payload: AgentEvent) {
  const store = useAIStore.getState();

  switch (payload.type) {
    case "stream_delta": {
      pendingDelta += payload.text || "";
      if (deltaRafId === null) {
        deltaRafId = requestAnimationFrame(flushDelta);
      }
      break;
    }
    case "thinking_delta": {
      const msgs = store.messages;
      let lastAssistantIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") { lastAssistantIdx = i; break; }
      }
      const thoughtBefore = lastAssistantIdx > 0 && msgs[lastAssistantIdx - 1].role === "thought"
        ? msgs[lastAssistantIdx - 1]
        : null;

      if (thoughtBefore) {
        store.updateMessage(thoughtBefore.id, thoughtBefore.content + (payload.text || ""));
      } else {
        store.insertThoughtBeforeLastAssistant(payload.text || "");
      }
      break;
    }
    case "tool_call": {
      store.appendMessage({
        id: crypto.randomUUID(),
        role: "toolCall",
        content: payload.name || "",
        toolCallName: payload.name,
        toolCallId: payload.id,
        toolInput: payload.input ? JSON.stringify(payload.input) : undefined,
      });
      break;
    }
    case "tool_result": {
      store.appendMessage({
        id: crypto.randomUUID(),
        role: "toolResult",
        content: payload.content || "",
        toolCallId: payload.tool_use_id,
        isError: payload.is_error ?? false,
      });
      store.appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
      });
      break;
    }
    case "iteration": {
      store.setIteration(payload.current ?? 0, payload.max ?? 0);
      break;
    }
    case "agent_done": {
      flushDelta();
      store.setStreaming(false);
      store.persistCurrentTurn();
      break;
    }
    case "error": {
      flushDelta();
      store.appendMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: payload.message || "Unknown error",
      });
      store.setStreaming(false);
      store.persistCurrentTurn();
      break;
    }
  }
}

/**
 * Hook that registers all Tauri backend event listeners.
 * Extracted from Layout.tsx to keep it focused on layout concerns.
 */
export function useTauriEvents() {
  const navigate = useNavigate();

  // Sync selected session IDs to Rust so AI tools can read them.
  useEffect(() => {
    let prevIds = useAppStore.getState().selectedSessionIds;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.selectedSessionIds !== prevIds) {
        prevIds = state.selectedSessionIds;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("ai_set_selected_sessions", {
              ids: [...state.selectedSessionIds],
            }).catch(() => {});
          }).catch(() => {});
        }, 100);
      }
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // Listen for proxy capture and AI agent events from Rust backend.
  useEffect(() => {
    let cancelled = false;
    let unlistenProxy: (() => void) | undefined;
    let unlistenAgent: (() => void) | undefined;
    let unlistenBreakpoint: (() => void) | undefined;
    let unlistenBpRules: (() => void) | undefined;
    let unlistenScriptLog: (() => void) | undefined;
    let unlistenScriptChanged: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;

      listen<CapturedSession>("proxy:capture", (event) => {
        useAppStore.getState().prependSession(capturedToSessionItem(event.payload));
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlistenProxy = fn;
      });

      listen<AgentEvent>("ai:agent_event", (event) => {
        handleAgentEvent(event.payload);
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlistenAgent = fn;
      });

      listen<PausedExchange>("breakpoint:paused", (event) => {
        useBreakpointStore.getState().setCurrentExchange(event.payload);
        navigate("/breakpoints");
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlistenBreakpoint = fn;
      });

      listen<{ enabled: boolean; rules: BreakpointRule[] }>("breakpoint:rules_changed", (event) => {
        useBreakpointStore.getState().syncFromBackend(event.payload.enabled, event.payload.rules);
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlistenBpRules = fn;
      });

      listen<ScriptExecutionLog[]>("script:execution_log", (event) => {
        useScriptStore.getState().appendLogs(event.payload);
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlistenScriptLog = fn;
      });

      listen<ScriptRule[]>("script:scripts_changed", (event) => {
        useScriptStore.getState().syncFromBackend(event.payload);
      }).then((fn) => {
        if (cancelled) { fn(); return; }
        unlistenScriptChanged = fn;
      });
    }).catch(() => {
      // Not in Tauri webview (e.g. plain browser during dev)
    });

    return () => {
      cancelled = true;
      unlistenProxy?.();
      unlistenAgent?.();
      unlistenBreakpoint?.();
      unlistenBpRules?.();
      unlistenScriptLog?.();
      unlistenScriptChanged?.();
    };
  }, []);
}
