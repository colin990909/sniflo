import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ScriptEditor } from "./ScriptEditor";
import { useScriptStore } from "@/stores/script-store";

vi.mock("@codemirror/view", () => {
  class EditorView {
    state: { doc: { toString: () => string } };

    constructor({ state, parent }: { state: { doc: { toString: () => string } }; parent?: HTMLElement }) {
      this.state = state;
      parent?.setAttribute("data-codemirror-mounted", "true");
    }

    destroy() {}

    static theme(config: unknown) {
      return config;
    }
  }

  return { EditorView };
});

vi.mock("codemirror", () => ({
  basicSetup: {},
}));

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: ({ doc }: { doc: string }) => ({
      doc: {
        toString: () => doc,
      },
    }),
  },
}));

vi.mock("@codemirror/lang-javascript", () => ({
  javascript: () => ({}),
}));

vi.mock("@codemirror/theme-one-dark", () => ({
  oneDark: {},
}));

describe("ScriptEditor", () => {
  beforeEach(() => {
    useScriptStore.setState({
      scripts: [
        {
          id: "script-1",
          name: "Inject Header",
          urlPattern: "https://api.example.com/*",
          phase: "request",
          priority: 0,
          enabled: true,
          code: "function onRequest() {}",
          createdAt: "0",
          updatedAt: "0",
        },
      ],
      selectedScriptId: "script-1",
      testScript: vi.fn(async () => "ok"),
      update: vi.fn(async () => {}),
    });
  });

  test("uses compact workbench-styled script actions and flat controls", () => {
    const { container } = render(<ScriptEditor />);

    expect(screen.getByRole("button", { name: "Test" }).className).toContain("bg-script/8");
    expect(screen.getByRole("button", { name: "Test" }).className).toContain("border-script/25");
    expect(screen.getByRole("button", { name: "Test" }).className).toContain("w-8");
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("shadow-none");
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("w-8");
    expect(screen.getByPlaceholderText("Name").className).toContain("bg-background");
    expect(screen.getByPlaceholderText("Name").className).toContain("shadow-none");
    expect(container.querySelector(".gap-3")).toBeNull();
    expect(screen.queryByText("Scripts")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Inject Header" })).toBeNull();
    expect(screen.queryByText("Test")).toBeNull();
    expect(screen.queryByText("Save")).toBeNull();
  });
});
