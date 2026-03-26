import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AIWorkspacePage } from "./AIWorkspacePage";
import { useAIStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSkillStore } from "@/stores/skill-store";

const invokeMock = vi.fn();

function setCaret(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function typeIntoComposer(editor: HTMLElement, text: string, caretOffset = text.length) {
  editor.focus();
  editor.textContent = text;
  const textNode = editor.firstChild ?? editor.appendChild(document.createTextNode(text));
  setCaret(textNode, caretOffset);
  fireEvent.input(editor);
}

function setScrollMetrics(element: HTMLElement, metrics: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}) {
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: metrics.scrollTop,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });

  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "ai_list_skills") {
      return Promise.resolve([]);
    }
    if (command === "ai_runtime_list_models") {
      return Promise.resolve([
        { id: "gpt-5-codex", displayName: "GPT-5 Codex" },
        { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
      ]);
    }
    return Promise.resolve(undefined);
  });

  useAIStore.setState({
    messages: [],
    draftMessage: "",
    draftAttachedSessionIds: [],
    isStreaming: false,
    activeSkill: null,
    conversations: [],
    conversationCreated: false,
    lastSavedMessageCount: 0,
    currentIteration: 0,
    maxIterations: 0,
  });

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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastHealthcheck: null,
      },
    ],
    selectedRuntimeId: "rt-1",
  });

  useSkillStore.setState({
    skills: [],
    isLoading: false,
  });
});

describe("AIWorkspacePage", () => {
  test("keeps the composer shell overflow visible so runtime menus are not clipped", () => {
    render(<AIWorkspacePage />);

    const composerShell = screen.getByTestId("ai-composer-shell");

    expect(composerShell).toBeInTheDocument();
    expect(composerShell).toHaveClass("overflow-visible");
    expect(composerShell).not.toHaveClass("overflow-hidden");
  });

  test("keeps the runtime selector trigger on a single line", async () => {
    render(<AIWorkspacePage />);

    const runtimeTrigger = (await screen.findByText("GPT-5 Codex")).closest("button");

    expect(runtimeTrigger).toBeInTheDocument();
    expect(runtimeTrigger).toHaveClass("whitespace-nowrap");
  });

  test("loads runtime models and opens a model menu instead of a runtime menu", async () => {
    render(<AIWorkspacePage />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ai_runtime_list_models", { runtimeId: "rt-1" });
    });

    const modelTrigger = screen.getByText("GPT-5 Codex").closest("button");
    expect(modelTrigger).toBeInTheDocument();

    fireEvent.click(modelTrigger!);

    expect(await screen.findByText("GPT-5.3 Codex")).toBeInTheDocument();
    expect(screen.queryByText("gpt-5.3-codex")).not.toBeInTheDocument();
  });

  test("does not render a skill selector even when skills are available", () => {
    useSkillStore.setState({
      skills: [{ name: "Traffic Inspector", version: "1.0.0", description: "", toolCount: 1 }],
      isLoading: false,
    });
    useAIStore.setState({
      activeSkill: "Traffic Inspector",
    });

    render(<AIWorkspacePage />);

    expect(screen.queryByRole("button", { name: "Traffic Inspector" })).toBeNull();
  });

  test("does not send when Enter is used to confirm IME composition", () => {
    const sendDraft = vi.fn();
    useAIStore.setState({
      draftMessage: "ni",
      sendDraft,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    Object.defineProperty(composingEnter, "isComposing", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(composingEnter, "keyCode", {
      configurable: true,
      value: 229,
    });

    editor.dispatchEvent(composingEnter);

    expect(sendDraft).not.toHaveBeenCalled();
  });

  test("renders the sidebar and chat pane inside a content row below the header", async () => {
    render(<AIWorkspacePage />);

    fireEvent.click(screen.getByTitle("Conversations"));

    const pageRoot = screen.getByTestId("ai-workspace-root");
    const contentRow = screen.getByTestId("ai-workspace-content");
    const toolbar = pageRoot.querySelector(".toolbar-surface");
    const sidebarTitle = await screen.findByText("Conversations");
    const sidebar = sidebarTitle.closest(".conv-sidebar") as HTMLElement | null;

    expect(pageRoot).toHaveClass("flex-col");
    expect(toolbar).toBeInTheDocument();
    expect(pageRoot.firstElementChild).toBe(toolbar);
    expect(pageRoot.children[1]).toBe(contentRow);
    expect(contentRow).toContainElement(sidebar);
  });

  test("keeps composer controls in normal flow so long input does not overlap them", () => {
    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const controlsRow = screen.getByTestId("ai-composer-controls");

    expect(controlsRow).not.toHaveClass("absolute");
    expect(editor).not.toHaveClass("pb-10");
  });

  test("renders an assistant-style HTTP empty state", () => {
    render(<AIWorkspacePage />);

    expect(screen.getByText("What would you like to investigate today?")).toBeInTheDocument();
    expect(screen.getByText("Why is this request failing?")).toBeInTheDocument();
    expect(screen.queryByText("Analyze Request")).not.toBeInTheDocument();
  });

  test("renders a clean conversation layout without avatars and with user messages on the right", () => {
    useAIStore.setState({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Why is this request failing?",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "The upstream returned a 302 before the auth cookie was set.",
        },
      ],
    });

    render(<AIWorkspacePage />);

    const userMessage = screen.getByTestId("chat-user-message");
    const userBubble = userMessage.querySelector(".rounded-2xl");
    const assistantTurn = screen.getByTestId("chat-assistant-turn");

    expect(userMessage).toHaveClass("justify-end");
    expect(userBubble).toHaveClass("text-left");
    expect(userBubble).not.toHaveClass("text-right");
    expect(screen.queryByTestId("chat-user-avatar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-assistant-avatar")).not.toBeInTheDocument();
    expect(assistantTurn).toBeInTheDocument();
  });

  test("wraps long assistant message content instead of letting it overflow the bubble", () => {
    useAIStore.setState({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "https://example.com/" + "a".repeat(240),
        },
      ],
    });

    render(<AIWorkspacePage />);

    const content = screen.getByText(/https:\/\/example\.com\//).closest("div");

    expect(content).toBeInTheDocument();
    expect(content).toHaveClass("[overflow-wrap:anywhere]");
  });

  test("stops auto-scrolling during streaming after the user scrolls up", () => {
    useAIStore.setState({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Initial streaming answer",
        },
      ],
      isStreaming: true,
    });

    render(<AIWorkspacePage />);

    const scrollPanel = screen.getByTestId("ai-scroll-panel");
    const scrollToMock = vi.mocked(HTMLElement.prototype.scrollTo);

    setScrollMetrics(scrollPanel, {
      scrollTop: 120,
      clientHeight: 300,
      scrollHeight: 1200,
    });
    scrollToMock.mockClear();

    fireEvent.scroll(scrollPanel);

    act(() => {
      useAIStore.setState({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "Initial streaming answer with more streamed text",
          },
        ],
        isStreaming: true,
      });
    });

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  test("uses a streaming animation class on the live assistant message", () => {
    useAIStore.setState({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Streaming answer",
        },
      ],
      isStreaming: true,
    });

    render(<AIWorkspacePage />);

    const streamingBlock = screen.getByText("Streaming answer").closest("div");

    expect(streamingBlock).toBeInTheDocument();
    expect(streamingBlock).toHaveClass("ai-streaming-block");
  });

  test("shows thinking content while the assistant is still streaming", () => {
    useAIStore.setState({
      messages: [
        {
          id: "thought-1",
          role: "thought",
          content: "Checking the redirect and auth cookie flow...",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
        },
      ],
      isStreaming: true,
    });

    render(<AIWorkspacePage />);

    expect(screen.getByText("Checking the redirect and auth cookie flow...")).toBeInTheDocument();
  });

  test("does not render Invalid Date for legacy conversation timestamps", async () => {
    useAIStore.setState({
      conversations: [
        {
          id: "conv-invalid",
          title: "Legacy conversation",
          runtimeId: "rt-1",
          skillName: null,
          modelOverride: null,
          createdAt: "not-a-date",
          updatedAt: "not-a-date",
        },
      ] as never[],
    });

    render(<AIWorkspacePage />);

    fireEvent.click(screen.getByTitle("Conversations"));

    await screen.findByText("Legacy conversation");
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
  });

  test("opens a request picker when typing @ and filters by host", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Example API",
          host: "api.example.com",
          detail: {
            method: "GET",
            url: "https://api.example.com/v1/users",
            statusCode: 200,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
        {
          id: "session-2",
          title: "Auth API",
          host: "auth.example.com",
          detail: {
            method: "POST",
            url: "https://auth.example.com/login",
            statusCode: 302,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");

    typeIntoComposer(editor, "@auth");

    expect(screen.getByTestId("ai-mention-picker")).toBeInTheDocument();
    expect(screen.getByTestId("ai-mention-option-session-2")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-mention-option-session-1")).not.toBeInTheDocument();
  });

  test("inserts an inline @ token from the mention picker and syncs selected sessions", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Example API",
          host: "api.example.com",
          detail: {
            method: "GET",
            url: "https://api.example.com/v1/users",
            statusCode: 200,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
        {
          id: "session-2",
          title: "Auth API",
          host: "auth.example.com",
          detail: {
            method: "POST",
            url: "https://auth.example.com/login",
            statusCode: 302,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    typeIntoComposer(editor, "Check @auth");

    fireEvent.mouseDown(screen.getByTestId("ai-mention-option-session-2"));

    const token = screen.getByText("@auth.example.com");

    expect(token).toBeInTheDocument();
    expect(token).toHaveClass("truncate");
    expect(token).toHaveClass("whitespace-nowrap");
    expect(useAIStore.getState().draftMessage).not.toContain("@auth");
    expect(useAppStore.getState().selectedSessionIds.has("session-2")).toBe(true);
  });

  test("keeps multiple inline @ tokens compact with visible caret anchors between them", () => {
    useAIStore.setState({
      draftAttachedSessionIds: ["session-1", "session-2"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Example API",
          host: "api.example.com",
          detail: null,
        },
        {
          id: "session-2",
          title: "Auth API",
          host: "auth.example.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const firstToken = screen.getByText("@api.example.com").parentElement;
    const secondToken = screen.getByText("@auth.example.com").parentElement;

    expect(firstToken).toBeInTheDocument();
    expect(secondToken).toBeInTheDocument();
    expect(editor).toHaveClass("leading-7");
    expect(firstToken).toHaveClass("py-[3px]");
    expect(firstToken).toHaveClass("leading-none");
    expect(editor.childNodes[1]?.nodeType).toBe(Node.TEXT_NODE);
    expect(editor.childNodes[1]?.textContent).toBe("\u2009");
  });

  test("keeps a caret anchor after inline @ tokens when there is no draft text", () => {
    useAIStore.setState({
      draftAttachedSessionIds: ["session-1", "session-2"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Example API",
          host: "api.example.com",
          detail: null,
        },
        {
          id: "session-2",
          title: "Auth API",
          host: "auth.example.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");

    expect(editor.lastChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  test("moves the caret to the trailing anchor when focusing a token-only composer", () => {
    useAIStore.setState({
      draftAttachedSessionIds: ["session-1"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Clients",
          host: "clients4.google.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const trailingAnchor = editor.lastChild;

    editor.focus();
    fireEvent.focus(editor);

    const selection = window.getSelection();

    expect(trailingAnchor?.nodeType).toBe(Node.TEXT_NODE);
    expect(selection?.anchorNode).toBe(trailingAnchor);
  });

  test("moves the caret across adjacent inline @ tokens onto the text anchor between them", () => {
    useAIStore.setState({
      draftAttachedSessionIds: ["session-1", "session-2"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Clients",
          host: "clients4.google.com",
          detail: null,
        },
        {
          id: "session-2",
          title: "Gateway",
          host: "dev.gateway.huifangzx.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const middleAnchor = editor.childNodes[1];
    const trailingAnchor = editor.childNodes[3];

    expect(middleAnchor?.nodeType).toBe(Node.TEXT_NODE);
    expect(trailingAnchor?.nodeType).toBe(Node.TEXT_NODE);

    setCaret(trailingAnchor!, trailingAnchor.textContent?.length ?? 0);
    fireEvent.keyDown(editor, { key: "ArrowLeft" });

    let selection = window.getSelection();
    expect(selection?.anchorNode).toBe(middleAnchor);
    expect(selection?.anchorOffset).toBe(middleAnchor?.textContent?.length ?? 0);

    fireEvent.keyDown(editor, { key: "ArrowLeft" });

    selection = window.getSelection();
    expect(selection?.anchorNode).toBe(editor);
    expect(selection?.anchorOffset).toBe(0);

    fireEvent.keyDown(editor, { key: "ArrowRight" });

    selection = window.getSelection();
    expect(selection?.anchorNode).toBe(middleAnchor);
    expect(selection?.anchorOffset).toBe(middleAnchor?.textContent?.length ?? 0);
  });

  test("normalizes a selection that lands inside an inline @ token back to the nearest text anchor", () => {
    useAIStore.setState({
      draftAttachedSessionIds: ["session-1", "session-2"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Clients",
          host: "clients4.google.com",
          detail: null,
        },
        {
          id: "session-2",
          title: "Gateway",
          host: "dev.gateway.huifangzx.com",
          detail: null,
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const middleAnchor = editor.childNodes[1];
    const firstTokenLabel = screen.getByText("@clients4.google.com").firstChild;

    expect(middleAnchor?.nodeType).toBe(Node.TEXT_NODE);
    expect(firstTokenLabel?.nodeType).toBe(Node.TEXT_NODE);

    setCaret(firstTokenLabel!, 1);
    fireEvent.keyUp(editor, { key: "ArrowRight" });

    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(middleAnchor);
    expect(selection?.anchorOffset).toBe(middleAnchor?.textContent?.length ?? 0);
  });

  test("does not mirror selected sessions into the composer by default", async () => {
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

    render(<AIWorkspacePage />);

    await waitFor(() => {
      expect(useAIStore.getState().draftAttachedSessionIds).toEqual([]);
    });

    expect(screen.queryByText("@auth.example.com")).not.toBeInTheDocument();
  });

  test("renders the mention picker above the composer controls so it is not blocked", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Auth API",
          host: "auth.example.com",
          detail: {
            method: "POST",
            url: "https://auth.example.com/login",
            statusCode: 302,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
      ],
      selectedSessionIds: new Set<string>(),
      anchorSessionId: null,
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    typeIntoComposer(editor, "@auth");

    const picker = screen.getByTestId("ai-mention-picker");

    expect(picker).toHaveClass("bottom-[calc(100%+0.35rem)]");
    expect(picker).not.toHaveClass("top-[calc(100%+0.35rem)]");
  });

  test("removes an adjacent inline @ token when Backspace is pressed at the text boundary", () => {
    useAIStore.setState({
      draftMessage: " investigate this flow",
      draftAttachedSessionIds: ["session-1"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Auth API",
          host: "auth.example.com",
          detail: {
            method: "POST",
            url: "https://auth.example.com/login",
            statusCode: 302,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
      ],
      selectedSessionIds: new Set(["session-1"]),
      anchorSessionId: "session-1",
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const trailingTextNode = Array.from(editor.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(" investigate this flow"),
    );

    expect(trailingTextNode).toBeTruthy();

    setCaret(trailingTextNode!, 0);
    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(screen.queryByText("@auth.example.com")).not.toBeInTheDocument();
    expect(editor.textContent).toContain("investigate this flow");
  });

  test("moves the caret across an inline @ token instead of entering it with ArrowLeft", () => {
    useAIStore.setState({
      draftMessage: " investigate this flow",
      draftAttachedSessionIds: ["session-1"],
    });
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Auth API",
          host: "auth.example.com",
          detail: {
            method: "POST",
            url: "https://auth.example.com/login",
            statusCode: 302,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date().toISOString(),
          },
        },
      ],
      selectedSessionIds: new Set(["session-1"]),
      anchorSessionId: "session-1",
    });

    render(<AIWorkspacePage />);

    const editor = screen.getByTestId("ai-composer-editor");
    const trailingTextNode = Array.from(editor.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(" investigate this flow"),
    );

    expect(trailingTextNode).toBeTruthy();

    setCaret(trailingTextNode!, 0);
    fireEvent.keyDown(editor, { key: "ArrowLeft" });

    const selection = window.getSelection();

    expect(selection?.anchorNode).toBe(editor);
    expect(selection?.anchorOffset).toBe(0);
  });

  test("shows sent references in the user bubble", () => {
    useAIStore.setState({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Inspect this flow",
          attachedSessions: [
            {
              id: "session-1",
              host: "auth.example.com",
            },
          ],
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "I checked the auth flow.",
        },
      ],
    });

    render(<AIWorkspacePage />);

    expect(screen.getByTestId("chat-user-attachments")).toBeInTheDocument();
    expect(screen.getByTestId("chat-user-attachments")).toHaveClass("justify-start");
    expect(screen.getAllByText("@auth.example.com")[0]).toBeInTheDocument();
  });
});
