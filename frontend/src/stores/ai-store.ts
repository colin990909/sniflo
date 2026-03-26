import { create } from "zustand";
import { toast } from "sonner";
import i18n from "@/i18n";
import { useAppStore } from "./app-store";
import { useRuntimeStore } from "./runtime-store";
import { buildConversationHistory } from "./conversation-history";

export interface AttachedSessionRef {
  id: string;
  host: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "thought" | "toolCall" | "toolResult" | "observation";
  content: string;
  toolCallName?: string;
  toolCallId?: string;
  toolInput?: string;
  isError?: boolean;
  attachedSessions?: AttachedSessionRef[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  runtimeId: string | null;
  skillName: string | null;
  modelOverride: string | null;
  primaryHost: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PersistedMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  toolCallName: string | null;
  toolCallId: string | null;
  toolInput: string | null;
}

const INPUT_HISTORY_MAX = 100;

interface AIState {
  messages: ChatMessage[];
  draftMessage: string;
  draftAttachedSessionIds: string[];
  isStreaming: boolean;
  conversationId: string;
  currentIteration: number;
  maxIterations: number;
  activeSkill: string | null;
  modelOverride: string | null;

  // Conversation persistence
  conversations: ConversationSummary[];
  conversationCreated: boolean;
  lastSavedMessageCount: number;

  // Input history (in-memory only)
  isLoadingConversation: boolean;

  inputHistory: string[];
  inputHistoryIndex: number;

  setDraft: (msg: string) => void;
  setDraftAttachedSessionIds: (ids: string[]) => void;
  sendDraft: () => void;
  regenerateLastResponse: () => void;
  editAndResend: (messageId: string) => void;
  cancelStreaming: () => void;
  clearMessages: () => void;
  appendMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, content: string) => void;
  updateLastAssistantMessage: (content: string) => void;
  insertThoughtBeforeLastAssistant: (text: string) => void;
  setStreaming: (streaming: boolean) => void;
  setIteration: (current: number, max: number) => void;
  setActiveSkill: (name: string | null) => void;
  setModelOverride: (model: string | null) => void;

  // Conversation management
  loadConversations: () => Promise<void>;
  switchConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  exportConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  persistCurrentTurn: () => Promise<void>;

  // Input history navigation
  addToInputHistory: (text: string) => void;
  navigateInputHistory: (direction: "up" | "down") => string | null;
}

export const useAIStore = create<AIState>((set, get) => ({
  messages: [],
  draftMessage: "",
  draftAttachedSessionIds: [],
  isStreaming: false,
  conversationId: crypto.randomUUID(),
  currentIteration: 0,
  maxIterations: 0,
  activeSkill: null,
  modelOverride: null,

  conversations: [],
  conversationCreated: false,
  lastSavedMessageCount: 0,

  isLoadingConversation: false,

  inputHistory: [],
  inputHistoryIndex: -1,

  setDraft: (msg) => set({ draftMessage: msg }),
  setDraftAttachedSessionIds: (ids) => set({ draftAttachedSessionIds: ids }),

  sendDraft: () => {
    const draft = get().draftMessage.trim();
    if (!draft || get().isStreaming) return;

    const runtime = useRuntimeStore.getState().selectedRuntime();
    if (!runtime) return;

    // Record input history
    get().addToInputHistory(draft);

    const conversationId = get().conversationId;
    const appState = useAppStore.getState();
    const attachedSessionIds = [...get().draftAttachedSessionIds];
    const attachedSessions = attachedSessionIds
      .map((id) => appState.sessions.find((session) => session.id === id))
      .filter((session): session is NonNullable<typeof session> => !!session)
      .map((session) => ({ id: session.id, host: session.host }));
    const primaryHost = attachedSessions[0]?.host ?? null;

    // Create conversation in DB on first message
    if (!get().conversationCreated) {
      const title = draft.length > 50 ? draft.slice(0, 50) + "…" : draft;
      const createdAt = new Date().toISOString();
      import("@tauri-apps/api/core")
        .then(({ invoke }) => {
          invoke("conversation_create", {
            id: conversationId,
            title,
            runtimeId: runtime.id,
            skillName: get().activeSkill,
            modelOverride: get().modelOverride,
            primaryHost,
            createdAt,
          }).then(() => get().loadConversations()).catch((e: unknown) => {
            console.error(e);
            set({ conversationCreated: false });
            toast.error(i18n.t("ai.error.sendFailed"));
          });
        })
        .catch(console.error);
      set({ conversationCreated: true });
    } else if (primaryHost) {
      const currentConversation = get().conversations.find((entry) => entry.id === conversationId);
      if (!currentConversation?.primaryHost) {
        import("@tauri-apps/api/core")
          .then(({ invoke }) => {
            invoke("conversation_update_primary_host", {
              conversationId,
              primaryHost,
            }).then(() => get().loadConversations()).catch(console.error);
          })
          .catch(console.error);
      }
    }

    const conversationHistory = buildConversationHistory(get().messages);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft,
      attachedSessions,
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };

    set((state) => ({
      messages: [...state.messages, userMsg, assistantMsg],
      draftMessage: "",
      draftAttachedSessionIds: [],
      isStreaming: true,
      currentIteration: 0,
    }));

    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("ai_send_message", {
          request: {
            conversationId: get().conversationId,
            runtimeId: runtime.id,
            userMessage: draft,
            attachedSessionIds,
            skillName: get().activeSkill,
            modelOverride: get().modelOverride,
            maxIterations: 10,
            conversationHistory,
          },
        }).catch((e: unknown) => {
          const errorMsg = e instanceof Error ? e.message : String(e);
          get().appendMessage({
            id: crypto.randomUUID(),
            role: "system",
            content: `Failed to start agent: ${errorMsg}`,
          });
          set({ isStreaming: false });
        });
      })
      .catch(() => {
        toast.error(i18n.t("ai.error.sendFailed"));
        set({ isStreaming: false });
      });
  },

  regenerateLastResponse: () => {
    if (get().isStreaming) return;

    const messages = get().messages;
    // Find the last user message
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex === -1) return;

    const lastUserMsg = messages[lastUserIndex];
    const userContent = lastUserMsg.content;
    const userAttachedSessionIds = (lastUserMsg.attachedSessions ?? []).map((s) => s.id);

    // Remove from the last user message onwards
    set({
      messages: messages.slice(0, lastUserIndex),
      draftMessage: userContent,
      draftAttachedSessionIds: userAttachedSessionIds,
    });

    // Re-send via sendDraft
    get().sendDraft();
  },

  editAndResend: (messageId) => {
    if (get().isStreaming) return;
    const messages = get().messages;
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1 || messages[msgIndex].role !== "user") return;

    const userMsg = messages[msgIndex];
    const userAttachedSessionIds = (userMsg.attachedSessions ?? []).map((s) => s.id);

    set({
      messages: messages.slice(0, msgIndex),
      draftMessage: userMsg.content,
      draftAttachedSessionIds: userAttachedSessionIds,
    });

    // Auto-send after state update
    setTimeout(() => get().sendDraft(), 0);
  },

  cancelStreaming: () => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("ai_cancel", {
          conversationId: get().conversationId,
        }).catch(() => {});
      })
      .catch(() => {});
    set({ isStreaming: false });
  },

  clearMessages: () => {
    get().newConversation();
  },

  newConversation: () => {
    if (get().isStreaming) {
      get().cancelStreaming();
    }
    set({
      messages: [],
      isStreaming: false,
      conversationId: crypto.randomUUID(),
      conversationCreated: false,
      lastSavedMessageCount: 0,
      currentIteration: 0,
      maxIterations: 0,
      draftMessage: "",
      draftAttachedSessionIds: [],
      modelOverride: null,
    });
  },

  appendMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      return { messages: msgs };
    }),

  insertThoughtBeforeLastAssistant: (text) =>
    set((state) => {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs.splice(i, 0, {
            id: crypto.randomUUID(),
            role: "thought",
            content: text,
          });
          break;
        }
      }
      return { messages: msgs };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setIteration: (current, max) => set({ currentIteration: current, maxIterations: max }),

  setActiveSkill: (name) => set({ activeSkill: name }),

  setModelOverride: (model) => {
    set({ modelOverride: model });

    if (!get().conversationCreated) {
      return;
    }

    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("conversation_update_model_override", {
          conversationId: get().conversationId,
          modelOverride: model,
        }).then(() => get().loadConversations()).catch(console.error);
      })
      .catch(console.error);
  },

  // ── Conversation management ──────────────────────────────────

  loadConversations: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const conversations = await invoke<ConversationSummary[]>("conversation_list");
      set({ conversations });
    } catch {
      toast.error(i18n.t("ai.error.loadConversationsFailed"));
    }
  },

  switchConversation: async (id) => {
    if (get().isStreaming) {
      get().cancelStreaming();
    }
    set({ isLoadingConversation: true });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const conversation = get().conversations.find((entry) => entry.id === id);
      const persisted = await invoke<PersistedMessage[]>(
        "conversation_load_messages",
        { conversationId: id },
      );

      const chatMessages: ChatMessage[] = persisted.map((p) => ({
        id: p.id,
        role: p.role as ChatMessage["role"],
        content: p.content,
        toolCallName: p.toolCallName ?? undefined,
        toolCallId: p.toolCallId ?? undefined,
        toolInput: p.toolInput ?? undefined,
      }));

      set({
        messages: chatMessages,
        conversationId: id,
        conversationCreated: true,
        lastSavedMessageCount: chatMessages.length,
        isStreaming: false,
        isLoadingConversation: false,
        draftMessage: "",
        draftAttachedSessionIds: [],
        currentIteration: 0,
        maxIterations: 0,
        modelOverride: conversation?.modelOverride ?? null,
      });

      if (conversation?.runtimeId) {
        useRuntimeStore.getState().select(conversation.runtimeId);
      }
    } catch (e) {
      set({ isLoadingConversation: false });
      console.error("[ai-store] switchConversation failed:", e);
    }
  },

  deleteConversation: async (id) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("conversation_delete", { conversationId: id });

      // If deleting the current conversation, start fresh
      if (get().conversationId === id) {
        get().newConversation();
      }

      await get().loadConversations();
    } catch (e) {
      console.error("[ai-store] deleteConversation failed:", e);
    }
  },

  renameConversation: async (id, title) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("conversation_update_title", { conversationId: id, title });
      await get().loadConversations();
    } catch {
      toast.error(i18n.t("ai.error.loadConversationsFailed"));
    }
  },

  exportConversation: async (id) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { save } = await import("@tauri-apps/plugin-dialog");

      const msgs = await invoke<PersistedMessage[]>("conversation_load_messages", { conversationId: id });
      const conversation = get().conversations.find((c) => c.id === id);
      const title = conversation?.title ?? "Conversation";

      const lines: string[] = [`# ${title}\n`];
      for (const msg of msgs) {
        if (msg.role === "user") lines.push(`## User\n\n${msg.content}\n`);
        else if (msg.role === "assistant" && msg.content.trim()) lines.push(`## Assistant\n\n${msg.content}\n`);
        else if (msg.role === "toolCall") lines.push(`### Tool: ${msg.toolCallName ?? "unknown"}\n\n\`\`\`json\n${msg.toolInput ?? ""}\n\`\`\`\n`);
        else if (msg.role === "toolResult") lines.push(`### Result\n\n${msg.content}\n`);
      }

      const markdown = lines.join("\n");
      const safeName = title.slice(0, 50).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_");
      const filePath = await save({
        defaultPath: `${safeName}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!filePath) return;

      await invoke("write_text_file", { path: filePath, content: markdown });
    } catch {
      toast.error(i18n.t("ai.history.exportFailed"));
    }
  },

  persistCurrentTurn: async () => {
    const { messages, conversationId, lastSavedMessageCount, conversationCreated } = get();
    if (!conversationCreated) return;

    const unsaved = messages.slice(lastSavedMessageCount);
    // Filter out empty assistant placeholder messages
    const toSave = unsaved.filter(
      (m) => !(m.role === "assistant" && !m.content.trim()),
    );
    if (toSave.length === 0) return;

    const now = new Date().toISOString();
    const persistedMsgs: PersistedMessage[] = toSave.map((msg, i) => ({
      id: msg.id,
      conversationId,
      role: msg.role,
      content: msg.content,
      sortOrder: lastSavedMessageCount + i,
      createdAt: now,
      toolCallName: msg.toolCallName ?? null,
      toolCallId: msg.toolCallId ?? null,
      toolInput: msg.toolInput ?? null,
    }));

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("conversation_save_messages", { messages: persistedMsgs });
      set({ lastSavedMessageCount: messages.length });
      // Refresh conversation list to update updatedAt
      get().loadConversations();
    } catch (e) {
      console.error("[ai-store] persistCurrentTurn failed:", e);
    }
  },

  // ── Input history ────────────────────────────────────────────

  addToInputHistory: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => {
      const filtered = state.inputHistory.filter((h) => h !== trimmed);
      const updated = [...filtered, trimmed].slice(-INPUT_HISTORY_MAX);
      return { inputHistory: updated, inputHistoryIndex: -1 };
    });
  },

  navigateInputHistory: (direction) => {
    const { inputHistory, inputHistoryIndex } = get();
    if (inputHistory.length === 0) return null;

    let newIndex: number;
    if (direction === "up") {
      newIndex = inputHistoryIndex === -1
        ? inputHistory.length - 1
        : Math.max(0, inputHistoryIndex - 1);
    } else {
      if (inputHistoryIndex === -1) return null;
      newIndex = inputHistoryIndex + 1;
      if (newIndex >= inputHistory.length) {
        set({ inputHistoryIndex: -1 });
        return "";
      }
    }

    set({ inputHistoryIndex: newIndex });
    return inputHistory[newIndex];
  },
}));
