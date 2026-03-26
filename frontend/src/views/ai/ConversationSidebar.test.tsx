import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ConversationSidebar } from "./ConversationSidebar";

describe("ConversationSidebar", () => {
  test("renders a favicon when primaryHost exists and a fallback icon when it does not", () => {
    render(
      <ConversationSidebar
        conversations={[
          {
            id: "conv-with-host",
            title: "Auth issue",
            runtimeId: "rt-1",
            skillName: null,
            modelOverride: null,
            primaryHost: "auth.example.com",
            createdAt: "2026-03-26T00:00:00Z",
            updatedAt: "2026-03-26T00:00:00Z",
          },
          {
            id: "conv-without-host",
            title: "Empty chat",
            runtimeId: "rt-1",
            skillName: null,
            modelOverride: null,
            primaryHost: null,
            createdAt: "2026-03-26T00:00:00Z",
            updatedAt: "2026-03-26T00:00:00Z",
          },
        ]}
        currentConversationId="conv-with-host"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByTestId("conversation-favicon-conv-with-host")).toHaveAttribute(
      "src",
      "https://auth.example.com/favicon.ico",
    );
    expect(screen.getByTestId("conversation-fallback-icon-conv-without-host")).toBeInTheDocument();
  });
});
