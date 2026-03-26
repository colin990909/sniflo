import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import i18n from "@/i18n";
import { ScriptList } from "./ScriptList";
import { useScriptStore } from "@/stores/script-store";

describe("ScriptList", () => {
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
    });
  });

  test("uses row highlight instead of an active badge for the selected script", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    const { container } = render(<ScriptList />);

    expect(screen.getByText("Inject Header").closest("div[class*='table-row-anchor']")).not.toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
    expect(container.querySelector(".text-script")).toBeNull();
    expect(screen.queryByText("1 script")).toBeNull();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.className).toContain("h-3");
    expect(checkbox.className).toContain("w-3");
    expect(checkbox.className).toContain("accent-breakpoint");
  });

  test("does not render the selected-state badge in Chinese either", async () => {
    try {
      await act(async () => {
        await i18n.changeLanguage("zh-Hans");
      });

      render(<ScriptList />);

      const urlPattern = screen.getByText("https://api.example.com/*");

      expect(urlPattern.className).toContain("min-w-0");
      expect(screen.queryByText("当前")).toBeNull();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  test("sizes the phase column to its content instead of forcing a narrow fixed width", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    const { container } = render(<ScriptList />);

    const header = container.querySelector(".table-header");
    const selectedRow = container.querySelector(".table-row-anchor");
    const phaseLabel = screen.getByText("Request");

    expect(header).not.toBeNull();
    expect(selectedRow).not.toBeNull();
    expect((header as HTMLDivElement).style.gridTemplateColumns).toBe("28px minmax(0,1fr) max-content 28px");
    expect((selectedRow as HTMLDivElement).style.gridTemplateColumns).toBe("28px minmax(0,1fr) max-content 28px");
    expect(phaseLabel.className).toContain("whitespace-nowrap");
  });

  test("keeps a visual gap between the phase label and delete action", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    render(<ScriptList />);

    const deleteButton = screen.getByTitle("Delete script");

    expect(deleteButton.className).toContain("justify-self-end");
    expect(deleteButton.className).toContain("pl-2");
  });
});
