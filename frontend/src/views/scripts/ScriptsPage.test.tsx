import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ScriptsPage } from "./ScriptsPage";
import { useScriptStore } from "@/stores/script-store";

vi.mock("./ScriptList", () => ({
  ScriptList: () => <div>Script list</div>,
}));

vi.mock("./ScriptEditor", () => ({
  ScriptEditor: () => <div>Script editor</div>,
}));

vi.mock("./ScriptLogPanel", () => ({
  ScriptLogPanel: () => <div>Script log panel</div>,
}));

describe("ScriptsPage", () => {
  beforeEach(() => {
    useScriptStore.setState({
      scripts: [
        {
          id: "script-1",
          name: "Inject Header",
          urlPattern: "*",
          phase: "request",
          priority: 0,
          enabled: true,
          code: "function onRequest() {}",
          createdAt: "0",
          updatedAt: "0",
        },
      ],
      selectedScriptId: "script-1",
      isEnabled: true,
    });
  });

  test("keeps the log panel flush with the divider without extra top margin", () => {
    render(<ScriptsPage />);

    const logPanelWrapper = screen.getByText("Script log panel").parentElement;

    expect(logPanelWrapper).not.toBeNull();
    expect(logPanelWrapper?.className).not.toContain("mt-2.5");
  });

  test("uses a flatter workbench shell instead of glass cards", () => {
    const { container } = render(<ScriptsPage />);

    expect(container.querySelectorAll(".glass-card")).toHaveLength(0);
  });

  test("styles the add-script action like a compact workbench button", () => {
    render(<ScriptsPage />);

    const button = screen.getByRole("button", { name: "New Script" });

    expect(button.className).toContain("border-script/25");
    expect(button.className).toContain("bg-script/8");
  });

  test("renders a breakpoint-style global enable switch in the toolbar", () => {
    render(<ScriptsPage />);

    const toggle = screen.getByRole("switch", { name: "Enable" });

    expect(toggle).toBeInTheDocument();
    expect(toggle.className).not.toContain("data-[state=checked]:bg-script");
    expect(toggle.className).toContain("data-[state=checked]:bg-primary");
  });
});
