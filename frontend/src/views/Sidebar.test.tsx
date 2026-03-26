import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test } from "vitest";
import { Sidebar } from "./Sidebar";
import { useProxyStore } from "@/stores/proxy-store";
import { useAppStore } from "@/stores/app-store";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { useSettingsStore } from "@/stores/settings-store";

describe("Sidebar", () => {
  beforeEach(() => {
    useProxyStore.setState({
      status: "stopped",
      listenHost: "127.0.0.1",
      listenPort: "9090",
      listenAddress: "http://127.0.0.1:9090",
      lastError: null,
    });
    useAppStore.setState({ sessions: [] });
    useBreakpointStore.setState({ pendingCount: 0 });
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        theme: "light",
      },
    }));
  });

  test("shows the stopped proxy state and a theme toggle", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText("Proxy Status · Stopped")).toBeInTheDocument();
    expect(screen.queryByText("System Readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("Configure the listening address and upstream proxy")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme/i })).toBeInTheDocument();
  });

  test("renders the brand lockup without the legacy HTTP Proxy label", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Sniflo")).toBeInTheDocument();
    expect(screen.queryByText("HTTP Proxy")).not.toBeInTheDocument();
  });

  test("renders the brand lockup without an outer glass card", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Sniflo").closest(".glass-card")).toBeNull();
  });

  test("renders the logo as a plain icon without the decorative tile", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    const logo = screen.getByAltText("Sniflo");
    expect(logo.parentElement?.className).not.toContain("border-primary/10");
    expect(logo.parentElement?.className).not.toContain("bg-primary/12");
    expect(logo.parentElement?.className).not.toContain("rounded-xl");
  });

  test("cycles the theme toggle between light and dark only", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(useSettingsStore.getState().settings.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(useSettingsStore.getState().settings.theme).toBe("light");
  });

  test("renders the theme toggle without a visible border", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: /theme/i });
    expect(toggle.className).not.toContain("border-border");
    expect(toggle.className).not.toContain(" border ");
  });
});
