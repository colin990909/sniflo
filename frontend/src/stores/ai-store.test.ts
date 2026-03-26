import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAIStore } from "./ai-store";
import { useAppStore } from "./app-store";
import { useRuntimeStore } from "./runtime-store";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("ai-store", () => {
  beforeEach(() => {
    invokeMock.mockReset();

    useAppStore.setState({
      sessions: [],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
      statusMessage: null,
    });

    useRuntimeStore.setState({
      runtimes: [
        {
          id: "rt-1",
          name: "Codex",
          runtimeType: "codex_local",
          config: {
            cliPath: "/usr/local/bin/codex",
            model: "gpt-5-codex",
          },
          isDefault: true,
          createdAt: "2026-03-25T00:00:00Z",
          updatedAt: "2026-03-25T00:00:00Z",
          lastHealthcheck: null,
        },
      ],
      selectedRuntimeId: "rt-1",
    });

    useAIStore.setState({
      messages: [],
      draftMessage: "",
      draftAttachedSessionIds: [],
      isStreaming: false,
      conversationId: "conv-1",
      currentIteration: 0,
      maxIterations: 0,
      activeSkill: null,
      conversations: [],
      conversationCreated: true,
      lastSavedMessageCount: 0,
      inputHistory: [],
      inputHistoryIndex: -1,
    });
  });

  test("sendDraft forwards the active conversation model override", async () => {
    invokeMock.mockResolvedValue(undefined);
    useAIStore.setState({
      draftMessage: "Inspect this traffic",
    });
    useAIStore.setState({ modelOverride: "gpt-5.3-codex" } as never);

    useAIStore.getState().sendDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invokeMock).toHaveBeenCalledWith("ai_send_message", {
      request: expect.objectContaining({
        runtimeId: "rt-1",
        modelOverride: "gpt-5.3-codex",
      }),
    });
  });

  test("sendDraft preserves draft attached sessions for follow-up turns and keeps session selection", async () => {
    invokeMock.mockResolvedValue(undefined);
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Auth API",
          host: "auth.example.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set(["session-1"]),
      anchorSessionId: "session-1",
    });
    useAIStore.setState({
      draftMessage: "Inspect this traffic",
      draftAttachedSessionIds: ["session-1"],
    });

    useAIStore.getState().sendDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAIStore.getState().draftAttachedSessionIds).toEqual(["session-1"]);
    expect(useAppStore.getState().selectedSessionIds.size).toBe(1);
    expect(useAppStore.getState().anchorSessionId).toBe("session-1");
  });

  test("sendDraft snapshots attached sessions onto the sent user message", async () => {
    invokeMock.mockResolvedValue(undefined);
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Auth API",
          host: "auth.example.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set(["session-1"]),
      anchorSessionId: "session-1",
    });
    useAIStore.setState({
      draftMessage: "Inspect this traffic",
      draftAttachedSessionIds: ["session-1"],
    });

    useAIStore.getState().sendDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAIStore.getState().messages[0]).toMatchObject({
      role: "user",
      content: "Inspect this traffic",
      attachedSessions: [
        {
          id: "session-1",
          host: "auth.example.com",
        },
      ],
    });
  });

  test("sendDraft reconstructs assistant tool_use history before tool results for follow-up turns", async () => {
    invokeMock.mockResolvedValue(undefined);
    useAIStore.setState({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Find the matching session",
        },
        {
          id: "tool-call-1",
          role: "toolCall",
          content: "search_sessions",
          toolCallName: "search_sessions",
          toolCallId: "call_function_1",
          toolInput: "{\"query\":\"foluwl09194c@outlook.com\"}",
        },
        {
          id: "tool-result-1",
          role: "toolResult",
          content: "{\"sessions\":[{\"id\":\"session-1\"}]}",
          toolCallId: "call_function_1",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "I found one matching account.",
        },
      ],
      draftMessage: "That account is enabled. Re-check it.",
    });

    useAIStore.getState().sendDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invokeMock).toHaveBeenCalledWith("ai_send_message", {
      request: expect.objectContaining({
        conversationHistory: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool_use",
                id: "call_function_1",
                name: "search_sessions",
              }),
            ]),
          }),
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool_result",
                tool_use_id: "call_function_1",
              }),
            ]),
          }),
        ]),
      }),
    });
  });

  test("newConversation clears the active model override", () => {
    useAIStore.setState({
      modelOverride: "gpt-5.3-codex",
      draftAttachedSessionIds: ["session-1"],
    } as never);

    useAIStore.getState().newConversation();

    expect((useAIStore.getState() as { modelOverride?: string | null }).modelOverride ?? null).toBeNull();
    expect(useAIStore.getState().draftAttachedSessionIds).toEqual([]);
  });

  test("switchConversation restores a persisted model override", async () => {
    invokeMock.mockResolvedValueOnce([]);
    useAIStore.setState({
      draftAttachedSessionIds: ["session-1"],
    } as never);
    useAIStore.setState({
      conversations: [
        {
          id: "conv-2",
          title: "Model test",
          runtimeId: "rt-1",
          skillName: null,
          modelOverride: "gpt-5.3-codex",
          createdAt: "2026-03-25T00:00:00Z",
          updatedAt: "2026-03-25T00:00:00Z",
        },
      ] as never[],
    });

    await useAIStore.getState().switchConversation("conv-2");

    expect(useRuntimeStore.getState().selectedRuntimeId).toBe("rt-1");
    expect((useAIStore.getState() as { modelOverride?: string | null }).modelOverride ?? null).toBe("gpt-5.3-codex");
    expect(useAIStore.getState().draftAttachedSessionIds).toEqual([]);
  });
});
