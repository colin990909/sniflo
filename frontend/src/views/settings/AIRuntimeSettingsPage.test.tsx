import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { AIRuntimeSettingsPage } from "./AIRuntimeSettingsPage";
import { useRuntimeStore } from "@/stores/runtime-store";

beforeEach(() => {
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
      {
        id: "rt-2",
        name: "Remote API",
        runtimeType: "remote_api",
        config: {
          protocol: "openai",
          endpointMode: "official",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-test",
          model: "gpt-4o",
        },
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastHealthcheck: null,
      },
    ],
    selectedRuntimeId: "rt-1",
  });
});

test("renders AI runtime configuration as a single-column flow without a dedicated sidebar", () => {
  render(<AIRuntimeSettingsPage />);

  expect(screen.getByTestId("runtime-settings-stack")).toBeInTheDocument();
  expect(screen.getByTestId("settings-section-header")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AI Configuration" })).toBeInTheDocument();
  expect(screen.queryByTestId("runtime-settings-sidebar")).not.toBeInTheDocument();
  expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "More options" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remote API" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Runtime" })).not.toBeInTheDocument();
});

test("shows model loading controls for codex runtimes", () => {
  render(<AIRuntimeSettingsPage />);

  const button = screen.getByRole("button", { name: "Fetch Models" });
  const modelInput = screen.getByDisplayValue("gpt-5-codex");

  expect(button).toBeInTheDocument();
  expect(modelInput.parentElement?.contains(button)).toBe(true);
});

test("shows model loading controls for claude code runtimes", () => {
  useRuntimeStore.setState({
    runtimes: [
      {
        id: "rt-claude",
        name: "Claude Code",
        runtimeType: "claude_code_local",
        config: {
          cliPath: "/usr/local/bin/claude",
          model: "claude-sonnet-4-5",
        },
        isDefault: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastHealthcheck: null,
      },
    ],
    selectedRuntimeId: "rt-claude",
  });

  render(<AIRuntimeSettingsPage />);

  const button = screen.getByRole("button", { name: "Fetch Models" });
  const modelInput = screen.getByDisplayValue("claude-sonnet-4-5");

  expect(button).toBeInTheDocument();
  expect(modelInput.parentElement?.contains(button)).toBe(true);
});

test("keeps the remote api form focused on protocol, base url, api key, and model", () => {
  useRuntimeStore.setState({
    selectedRuntimeId: "rt-2",
  });

  render(<AIRuntimeSettingsPage />);

  expect(screen.queryByRole("button", { name: "Fetch Models" })).not.toBeInTheDocument();
  expect(screen.queryByText("Endpoint Mode")).not.toBeInTheDocument();
  expect(screen.queryByText("Max Context Tokens")).not.toBeInTheDocument();
  expect(screen.getByText("OpenAI")).toBeInTheDocument();
  expect(screen.getByText("Anthropic")).toBeInTheDocument();
  expect(screen.queryByText("OpenAI-compatible")).not.toBeInTheDocument();
  expect(screen.queryByText("Anthropic-compatible")).not.toBeInTheDocument();
});
