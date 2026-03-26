import { beforeEach, describe, expect, test, vi } from "vitest";
import { useSettingsStore } from "./settings-store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

describe("settings-store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        theme: "light",
      },
      loaded: false,
    }));
  });

  test("includes a theme preference in default settings", () => {
    const settings = useSettingsStore.getState().settings as unknown as Record<string, unknown>;

    expect(settings.theme).toBe("light");
  });

  test("migrates a persisted system theme to light on load", async () => {
    vi.mocked(invoke).mockImplementation(async (command, payload) => {
      if (command === "load_settings") {
        return {
          ...useSettingsStore.getState().settings,
          theme: "system",
        };
      }

      if (command === "save_settings") {
        return payload;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().settings.theme).toBe("light");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("save_settings", {
      settings: expect.objectContaining({ theme: "light" }),
    });
  });
});
