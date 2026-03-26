import { beforeEach, describe, expect, test, vi } from "vitest";
import { useRuntimeStore } from "./runtime-store";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("runtime-store", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useRuntimeStore.setState({
      runtimes: [],
      selectedRuntimeId: null,
    });
  });

  test("load picks the default runtime", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "rt-codex",
        name: "Codex",
        runtimeType: "codex_local",
        isDefault: false,
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
        config: { cliPath: "/usr/local/bin/codex", model: "gpt-5-codex" },
      },
      {
        id: "rt-claude",
        name: "Claude Code",
        runtimeType: "claude_code_local",
        isDefault: true,
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
        config: { cliPath: "/usr/local/bin/claude", model: "claude-opus-4-1" },
      },
    ]);

    await useRuntimeStore.getState().load();

    expect(useRuntimeStore.getState().runtimes).toHaveLength(2);
    expect(useRuntimeStore.getState().selectedRuntimeId).toBe("rt-claude");
    expect(invokeMock).toHaveBeenCalledWith("load_runtimes");
  });

  test("add persists the new runtime", async () => {
    invokeMock.mockResolvedValue(undefined);

    useRuntimeStore.getState().add({
      id: "rt-remote",
      name: "Remote API",
      runtimeType: "remote_api",
      isDefault: true,
      createdAt: "2026-03-24T00:00:00Z",
      updatedAt: "2026-03-24T00:00:00Z",
      config: {
        protocol: "openai",
        endpointMode: "official",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-4o",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useRuntimeStore.getState().runtimes).toHaveLength(1);
    expect(useRuntimeStore.getState().selectedRuntimeId).toBe("rt-remote");
    expect(invokeMock).toHaveBeenCalledWith("save_runtimes", {
      runtimes: useRuntimeStore.getState().runtimes,
    });
  });
});
