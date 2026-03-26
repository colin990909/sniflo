import { beforeEach, describe, expect, test, vi } from "vitest";
import { useScriptStore } from "./script-store";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("script-store", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useScriptStore.setState({
      scripts: [],
      selectedScriptId: null,
      recentLogs: [],
      isLoading: false,
      isEnabled: false,
    } as never);
  });

  test("load hydrates both the global enabled flag and scripts", async () => {
    invokeMock.mockResolvedValueOnce([
      true,
      [
        {
          id: "script-1",
          name: "Inject Header",
          urlPattern: "*",
          phase: "both",
          priority: 0,
          enabled: true,
          code: "function onRequest() {}",
          createdAt: "0",
          updatedAt: "0",
        },
      ],
    ]);

    await useScriptStore.getState().load();

    expect(invokeMock).toHaveBeenCalledWith("load_script_config");
    expect((useScriptStore.getState() as { isEnabled: boolean }).isEnabled).toBe(true);
    expect(useScriptStore.getState().scripts).toHaveLength(1);
  });

  test("create persists newly created scripts as disabled by default", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce([]);

    await useScriptStore.getState().create("New Script");

    expect(invokeMock).toHaveBeenCalledWith(
      "create_script",
      expect.objectContaining({
        script: expect.objectContaining({
          name: "New Script",
          enabled: false,
        }),
      }),
    );
  });

  test("setEnabled updates local state and persists the global toggle", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    useScriptStore.getState().setEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((useScriptStore.getState() as { isEnabled: boolean }).isEnabled).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("set_script_enabled", { enabled: true });
  });
});
