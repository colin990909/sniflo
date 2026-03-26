import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { ProxySettings } from "./ProxySettings";
import { useProxyStore } from "@/stores/proxy-store";

beforeEach(() => {
  useProxyStore.setState((state) => ({
    ...state,
    status: "stopped",
    listenHost: "127.0.0.1",
    listenPort: "9090",
    upstreamEnabled: false,
    upstreamHost: "127.0.0.1",
    upstreamPort: "7890",
    corsOverrideEnabled: false,
  }));
});

test("renders proxy settings with the shared lightweight section header", () => {
  render(<ProxySettings />);

  expect(screen.getByTestId("settings-section-header")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Proxy Configuration" })).toBeInTheDocument();
  expect(screen.getByText("Configure the listening address and upstream proxy")).toBeInTheDocument();
});
