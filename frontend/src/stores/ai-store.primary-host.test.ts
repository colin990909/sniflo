import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAIStore } from "./ai-store";
import { useAppStore } from "./app-store";
import { useRuntimeStore } from "./runtime-store";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("ai-store primaryHost", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Auth API",
          host: "auth.example.com",
          detail: null,
        },
        {
          id: "session-2",
          title: "Profile API",
          host: "profile.example.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set(["session-1", "session-2"]),
      anchorSessionId: "session-1",
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
      draftMessage: "Inspect this traffic",
      draftAttachedSessionIds: ["session-1", "session-2"],
      isStreaming: false,
      conversationId: "conv-1",
      currentIteration: 0,
      maxIterations: 0,
      activeSkill: null,
      modelOverride: null,
      conversations: [],
      conversationCreated: false,
      lastSavedMessageCount: 0,
      inputHistory: [],
      inputHistoryIndex: -1,
    });
  });

  test("sendDraft includes the first attached session host when creating a conversation", async () => {
    useAIStore.getState().sendDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invokeMock).toHaveBeenCalledWith("conversation_create", {
      id: "conv-1",
      title: "Inspect this traffic",
      runtimeId: "rt-1",
      skillName: null,
      modelOverride: null,
      primaryHost: "auth.example.com",
      createdAt: expect.any(String),
    });
  });

  test("sendDraft backfills primaryHost for an existing conversation when the first attached session appears later", async () => {
    useAIStore.setState({
      conversationCreated: true,
      conversations: [
        {
          id: "conv-1",
          title: "Inspect this traffic",
          runtimeId: "rt-1",
          skillName: null,
          modelOverride: null,
          primaryHost: null,
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
        },
      ],
    });

    useAIStore.getState().sendDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invokeMock).toHaveBeenCalledWith("conversation_update_primary_host", {
      conversationId: "conv-1",
      primaryHost: "auth.example.com",
    });
  });
});
