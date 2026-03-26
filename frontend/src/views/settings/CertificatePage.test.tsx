import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CertificatePage } from "./CertificatePage";
import { useCertStore } from "@/stores/cert-store";
import { useProxyStore } from "@/stores/proxy-store";

describe("CertificatePage", () => {
  beforeEach(() => {
    useCertStore.setState((state) => ({
      ...state,
      hasCA: false,
      isInstalled: false,
      caPath: null,
      isGenerating: false,
      isInstalling: false,
      error: null,
      checkStatus: vi.fn().mockResolvedValue(undefined),
      generateCA: vi.fn().mockResolvedValue(undefined),
      installCA: vi.fn().mockResolvedValue(undefined),
      showInFinder: vi.fn().mockResolvedValue(undefined),
    }));

    useProxyStore.setState((state) => ({
      ...state,
      status: "stopped",
    }));
  });

  test("renders certificate readiness as a status panel instead of a numbered step flow", () => {
    render(<CertificatePage />);

    expect(screen.getByTestId("settings-section-header")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "HTTPS Configuration" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "HTTPS Readiness" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Certificate authority" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "System trust" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "When this takes effect" })).not.toBeInTheDocument();

    expect(screen.queryByText("Generate CA Certificate")).not.toBeInTheDocument();
    expect(screen.queryByText("Trust CA in System Keychain")).not.toBeInTheDocument();
    expect(screen.queryByText("Restart Capture")).not.toBeInTheDocument();
  });

  test("shows restart guidance when HTTPS is ready and capture is already running", () => {
    useCertStore.setState((state) => ({
      ...state,
      hasCA: true,
      isInstalled: true,
    }));
    useProxyStore.setState((state) => ({
      ...state,
      status: "running",
    }));

    render(<CertificatePage />);

    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText("HTTPS certificates are ready. Restart capture to apply them to the current proxy session.")).toBeInTheDocument();
  });

  test("does not show an extra bottom notice when HTTPS is ready and capture is stopped", () => {
    useCertStore.setState((state) => ({
      ...state,
      hasCA: true,
      isInstalled: true,
    }));

    render(<CertificatePage />);

    expect(screen.queryByText("HTTPS certificates are ready. They will be used the next time capture starts.")).not.toBeInTheDocument();
  });

  test("explains that trust depends on certificate generation when no CA exists", () => {
    render(<CertificatePage />);

    expect(screen.getAllByText("Not ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Generate a CA certificate before installing trust.")).toBeInTheDocument();
    expect(screen.getByText("Generate and trust the CA certificate before HTTPS traffic can be decrypted.")).toBeInTheDocument();
  });
});
