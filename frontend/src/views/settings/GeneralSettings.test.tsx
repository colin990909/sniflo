import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GeneralSettings } from "./GeneralSettings";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("@/stores/update-store", () => ({
  useUpdateStore: () => ({
    currentVersion: "0.1.0",
    latestRelease: null,
    hasUpdate: false,
    checking: false,
    error: null,
    initialize: vi.fn(),
    checkForUpdate: vi.fn(),
  }),
}));

describe("GeneralSettings", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        theme: "light",
      } as typeof state.settings,
    }));
  });

  test("renders light and dark theme choices without a system option", () => {
    render(<GeneralSettings />);

    expect(screen.getByTestId("settings-section-header")).toBeInTheDocument();
    expect(screen.queryByText("Preferences")).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dark"));

    const settings = useSettingsStore.getState().settings as unknown as Record<string, unknown>;
    expect(settings.theme).toBe("dark");
  });
});
