import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test } from "vitest";
import { SessionsPage } from "./SessionsPage";
import { useAppStore, type SessionDetail } from "@/stores/app-store";
import { useAIStore } from "@/stores/ai-store";

const detail: SessionDetail = {
  method: "GET",
  url: "https://api.example.com/users?id=1",
  statusCode: 200,
  requestHeaders: [["accept", "application/json"]],
  requestBody: "",
  responseHeaders: [["content-type", "application/json"]],
  responseBody: '{"ok":true}',
  timestamp: new Date().toISOString(),
  contentType: "application/json",
};

describe("SessionsPage", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: [
        {
          id: "session-1",
          title: "Users",
          host: "api.example.com",
          detail,
        },
        {
          id: "session-2",
          title: "Assets",
          host: "cdn.example.com",
          detail: {
            ...detail,
            url: "https://cdn.example.com/app.js",
          },
        },
      ],
      selectedSessionIds: new Set(["session-1"]),
      anchorSessionId: "session-1",
    });
    useAIStore.setState({
      draftMessage: "",
      draftAttachedSessionIds: [],
      messages: [],
      isStreaming: false,
    } as never);
  });

  test("uses a flatter workbench structure instead of glass cards", () => {
    const { container } = render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    expect(container.querySelectorAll(".glass-card")).toHaveLength(0);
  });

  test("keeps the workbench divider flush without an extra vertical gap", () => {
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("sessions-workbench").className).not.toContain("gap-2");
  });

  test("focuses search when pressing slash", () => {
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: "/" });

    expect(screen.getByPlaceholderText("Search host")).toHaveFocus();
  });

  test("moves the current selection with arrow keys", () => {
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    const workbench = screen.getByTestId("sessions-workbench");
    workbench.focus();
    fireEvent.keyDown(workbench, { key: "ArrowDown" });

    expect(useAppStore.getState().anchorSessionId).toBe("session-2");
    expect([...useAppStore.getState().selectedSessionIds]).toEqual(["session-2"]);
  });

  test("uses the primary workbench style for the send-to-ai batch action", () => {
    useAppStore.setState({
      selectedSessionIds: new Set(["session-1", "session-2"]),
      anchorSessionId: "session-2",
    });

    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>,
    );

    const button = screen.getByRole("button", { name: "Send to AI" });

    expect(button.className).not.toContain("text-ai");
    expect(button.className).toContain("border-primary/25");
  });

  test("sends the current session selection to the AI workspace", () => {
    useAppStore.setState({
      selectedSessionIds: new Set(["session-1", "session-2"]),
      anchorSessionId: "session-2",
    });

    render(
      <MemoryRouter initialEntries={["/sessions"]}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/ai" element={<div>AI Workspace</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send to AI" }));

    expect(useAIStore.getState().draftAttachedSessionIds).toEqual(["session-1", "session-2"]);
    expect(screen.getByText("AI Workspace")).toBeInTheDocument();
  });
});
