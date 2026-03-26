import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  HomePage,
  buildTrafficSnapshot,
  getSnapshotYAxisDomain,
  LIVE_CHART_CURVE_TYPE,
  LIVE_CHART_MARGIN,
  LIVE_WINDOW_SECONDS,
} from "./HomePage";
import { useProxyStore } from "@/stores/proxy-store";
import { useAppStore } from "@/stores/app-store";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { useCertStore } from "@/stores/cert-store";
import { useRuntimeStore } from "@/stores/runtime-store";

describe("HomePage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T10:00:30.000Z"));

    useProxyStore.setState({
      status: "running",
      listenHost: "127.0.0.1",
      listenPort: "9090",
      listenAddress: "http://127.0.0.1:9090",
      upstreamEnabled: false,
      corsOverrideEnabled: false,
    });
    useAppStore.setState({
      sessions: [
        {
          id: "s1",
          title: "Example",
          host: "api.example.com",
          detail: {
            method: "GET",
            url: "https://api.example.com/users",
            statusCode: 200,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date("2026-03-25T10:00:00.000Z").toISOString(),
          },
        },
        {
          id: "s2",
          title: "Example 2",
          host: "api.example.com",
          detail: {
            method: "POST",
            url: "https://api.example.com/login",
            statusCode: 201,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date("2026-03-25T10:00:20.000Z").toISOString(),
          },
        },
      ],
    });
    useBreakpointStore.setState({
      isEnabled: true,
      pendingCount: 2,
      rules: [],
    });
    useCertStore.setState({
      hasCA: true,
      isInstalled: true,
    });
    useRuntimeStore.setState({
      runtimes: [
        {
          id: "rt-1",
          name: "Claude Code",
          runtimeType: "claude_code_local",
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          config: {
            cliPath: "/usr/local/bin/claude",
            model: "claude-opus-4-1",
          },
        },
      ],
      selectedRuntimeId: "rt-1",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders the compact homepage sections without repeating the control-center title or tagline", () => {
    useProxyStore.setState((state) => ({
      ...state,
      upstreamEnabled: true,
      upstreamHost: "127.0.0.1",
      upstreamPort: "7890",
      corsOverrideEnabled: true,
    }));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Control Center")).toHaveLength(1);
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect traffic, automate breakpoints, and move from capture to analysis without losing context.")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument();
    expect(screen.getByText("Traffic Snapshot")).toBeInTheDocument();
    expect(screen.queryByText("System Readiness")).not.toBeInTheDocument();
    expect(screen.getAllByText("Captured")).toHaveLength(1);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.getByText("HTTPS")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:7890")).toBeInTheDocument();
    expect(screen.getByText("CORS")).toBeInTheDocument();
    expect(screen.getByTestId("traffic-snapshot-trend")).toBeInTheDocument();
    expect(screen.getByTestId("traffic-snapshot-trend")).toHaveClass("h-36");
    expect(screen.getByTestId("traffic-snapshot-trend").closest("button")).not.toHaveClass("border");
    expect(screen.getByTestId("traffic-snapshot-trend").closest("button")).toHaveClass("w-full");
    const snapshotHeader = screen.getByText("Traffic Snapshot").closest("div")?.parentElement;
    expect(snapshotHeader).not.toBeNull();
    expect(within(snapshotHeader as HTMLElement).queryByText("Configure")).not.toBeInTheDocument();
    expect(within(snapshotHeader as HTMLElement).queryByText("Stop Proxy")).not.toBeInTheDocument();
    const controlCenterHeading = screen.getByRole("heading", { name: "Control Center" });
    const cardHeader = controlCenterHeading.parentElement;
    expect(cardHeader).not.toBeNull();
    expect(within(cardHeader as HTMLElement).queryByText("Dashboard")).not.toBeInTheDocument();
    const actionGroup = screen.getByText("Configure").closest("div");
    expect(actionGroup).not.toBeNull();
    expect(actionGroup).not.toHaveClass("absolute");
  });

  test("keeps the control-center metrics column width stable across proxy states", () => {
    useProxyStore.setState((state) => ({
      ...state,
      status: "stopped",
    }));

    const { rerender } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Control Center" }).parentElement).toHaveClass("w-full");

    useProxyStore.setState((state) => ({
      ...state,
      status: "running",
    }));

    rerender(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Control Center" }).parentElement).toHaveClass("w-full");
  });

  test("keeps the traffic snapshot trend visible while the proxy is running even before traffic arrives", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "s-empty",
          title: "No Detail",
          host: "empty.example.com",
          detail: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("traffic-snapshot-trend")).toBeInTheDocument();
    expect(screen.queryByText("Start the proxy to see live traffic")).not.toBeInTheDocument();
  });

  test("renders a compact traffic snapshot empty state when the proxy is stopped and there is no timestamped activity", () => {
    useProxyStore.setState((state) => ({
      ...state,
      status: "stopped",
    }));
    useAppStore.setState({
      sessions: [
        {
          id: "s-empty",
          title: "No Detail",
          host: "empty.example.com",
          detail: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Start the proxy to see live traffic")).toBeInTheDocument();
    expect(screen.queryByTestId("traffic-snapshot-trend")).not.toBeInTheDocument();
    expect(screen.getByText("Start the proxy to see live traffic")).toHaveClass("px-4");
    expect(screen.getByText("Start the proxy to see live traffic")).not.toHaveClass("h-28");
    expect(screen.getByText("Start the proxy to see live traffic").closest("button")).toHaveClass("w-full");
  });

  test("renders the traffic snapshot for unix-second timestamps emitted by live proxy capture", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "s-live-1",
          title: "Live 1",
          host: "live.example.com",
          detail: {
            method: "GET",
            url: "https://live.example.com/a",
            statusCode: 200,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: String(Math.floor(new Date("2026-03-25T10:00:07.000Z").getTime() / 1000)),
          },
        },
        {
          id: "s-live-2",
          title: "Live 2",
          host: "live.example.com",
          detail: {
            method: "GET",
            url: "https://live.example.com/b",
            statusCode: 200,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: String(Math.floor(new Date("2026-03-25T10:00:47.000Z").getTime() / 1000)),
          },
        },
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("traffic-snapshot-trend")).toBeInTheDocument();
    expect(screen.queryByText("Start the proxy to see live traffic")).not.toBeInTheDocument();
  });

  test("slides the live traffic window forward every second", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "s-live-window",
          title: "Live Window",
          host: "live.example.com",
          detail: {
            method: "GET",
            url: "https://live.example.com/window",
            statusCode: 200,
            requestHeaders: [],
            requestBody: "",
            responseHeaders: [],
            responseBody: "",
            timestamp: new Date("2026-03-25T10:00:00.000Z").toISOString(),
          },
        },
      ],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("traffic-snapshot-trend")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(screen.getByTestId("traffic-snapshot-trend")).toBeInTheDocument();
    expect(screen.queryByText("Start the proxy to see live traffic")).not.toBeInTheDocument();
  });

  test("keeps an established peak height stable while it rolls left inside the live window", () => {
    const sessions = [
      {
        id: "peak-1",
        title: "Peak 1",
        host: "roll.example.com",
        detail: {
          method: "GET",
          url: "https://roll.example.com/1",
          statusCode: 200,
          requestHeaders: [],
          requestBody: "",
          responseHeaders: [],
          responseBody: "",
          timestamp: new Date("2026-03-25T10:00:20.100Z").toISOString(),
        },
      },
      {
        id: "peak-2",
        title: "Peak 2",
        host: "roll.example.com",
        detail: {
          method: "GET",
          url: "https://roll.example.com/2",
          statusCode: 200,
          requestHeaders: [],
          requestBody: "",
          responseHeaders: [],
          responseBody: "",
          timestamp: new Date("2026-03-25T10:00:20.300Z").toISOString(),
        },
      },
      {
        id: "peak-3",
        title: "Peak 3",
        host: "roll.example.com",
        detail: {
          method: "GET",
          url: "https://roll.example.com/3",
          statusCode: 200,
          requestHeaders: [],
          requestBody: "",
          responseHeaders: [],
          responseBody: "",
          timestamp: new Date("2026-03-25T10:00:20.700Z").toISOString(),
        },
      },
    ];

    const firstSnapshot = buildTrafficSnapshot(sessions, new Date("2026-03-25T10:00:30.400Z").getTime());
    const secondSnapshot = buildTrafficSnapshot(sessions, new Date("2026-03-25T10:00:31.400Z").getTime());

    const firstPeakIndex = firstSnapshot.findIndex((bucket) => bucket.count === 3);
    const secondPeakIndex = secondSnapshot.findIndex((bucket) => bucket.count === 3);

    expect(firstPeakIndex).toBeGreaterThan(0);
    expect(secondPeakIndex).toBe(firstPeakIndex - 1);
    expect(Math.max(...firstSnapshot.map((bucket) => bucket.count))).toBe(3);
    expect(Math.max(...secondSnapshot.map((bucket) => bucket.count))).toBe(3);
  });

  test("drops a peak only after it leaves the 30-second live window", () => {
    const sessions = [
      {
        id: "edge-1",
        title: "Edge 1",
        host: "edge.example.com",
        detail: {
          method: "GET",
          url: "https://edge.example.com/1",
          statusCode: 200,
          requestHeaders: [],
          requestBody: "",
          responseHeaders: [],
          responseBody: "",
          timestamp: new Date("2026-03-25T10:00:00.150Z").toISOString(),
        },
      },
      {
        id: "edge-2",
        title: "Edge 2",
        host: "edge.example.com",
        detail: {
          method: "GET",
          url: "https://edge.example.com/2",
          statusCode: 200,
          requestHeaders: [],
          requestBody: "",
          responseHeaders: [],
          responseBody: "",
          timestamp: new Date("2026-03-25T10:00:00.450Z").toISOString(),
        },
      },
    ];

    const beforeExpiry = buildTrafficSnapshot(sessions, new Date("2026-03-25T10:00:29.400Z").getTime());
    const afterExpiry = buildTrafficSnapshot(sessions, new Date("2026-03-25T10:00:30.400Z").getTime());

    expect(Math.max(...beforeExpiry.map((bucket) => bucket.count))).toBe(2);
    expect(Math.max(...afterExpiry.map((bucket) => bucket.count))).toBe(0);
  });

  test("adds bottom breathing room so the zero line is not clipped by the chart edge", () => {
    const snapshot = buildTrafficSnapshot([], new Date("2026-03-25T10:00:30.000Z").getTime());
    const [yMin, yMax] = getSnapshotYAxisDomain(snapshot);

    expect(yMin).toBe(0);
    expect(yMax).toBeGreaterThan(0);
    expect(LIVE_CHART_MARGIN.bottom).toBeGreaterThan(0);
    expect(LIVE_CHART_CURVE_TYPE).toBe("monotone");
  });

  test("uses a 30-second live window with one-second rolling buckets", () => {
    const snapshot = buildTrafficSnapshot([], new Date("2026-03-25T10:00:30.000Z").getTime());

    expect(LIVE_WINDOW_SECONDS).toBe(30);
    expect(snapshot).toHaveLength(30);
  });
});
