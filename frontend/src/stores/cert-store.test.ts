import { beforeEach, describe, expect, test, vi } from "vitest";
import { useCertStore } from "./cert-store";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("cert-store", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useCertStore.setState({
      hasCA: false,
      isInstalled: false,
      caPath: null,
      isGenerating: false,
      isInstalling: false,
      error: null,
    });
  });

  test("checkStatus maps tauri camelCase fields into frontend certificate state", async () => {
    invokeMock.mockResolvedValueOnce({
      hasCa: true,
      isInstalled: false,
      caPath: "/tmp/ca.crt",
    });

    await useCertStore.getState().checkStatus();

    expect(invokeMock).toHaveBeenCalledWith("get_cert_status");
    expect(useCertStore.getState().hasCA).toBe(true);
    expect(useCertStore.getState().isInstalled).toBe(false);
    expect(useCertStore.getState().caPath).toBe("/tmp/ca.crt");
  });
});
