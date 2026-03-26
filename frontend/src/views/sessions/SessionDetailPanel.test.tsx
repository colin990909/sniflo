import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SessionDetailPanel } from "./SessionDetailPanel";
import type { SessionDetail } from "@/stores/app-store";

const detail: SessionDetail = {
  method: "POST",
  url: "https://api.example.com/users?id=1",
  statusCode: 201,
  requestHeaders: [["content-type", "application/json"]],
  requestBody: '{"name":"Ada"}',
  responseHeaders: [["content-type", "application/json"]],
  responseBody: '{"ok":true}',
  timestamp: new Date().toISOString(),
  contentType: "application/json",
};

describe("SessionDetailPanel", () => {
  test("shows compact request metadata in the header summary", () => {
    render(
      <SessionDetailPanel
        detail={detail}
        activeTab="headers"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("api.example.com")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
  });

  test("formats unix-second timestamps in the header summary", () => {
    render(
      <SessionDetailPanel
        detail={{ ...detail, timestamp: "1774406407" }}
        activeTab="headers"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("1774406407")).not.toBeInTheDocument();
    expect(screen.getByText("10:40:07 AM")).toBeInTheDocument();
  });

  test("renders a copy-url quick action in the detail header", () => {
    const writeText = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <SessionDetailPanel
        detail={detail}
        activeTab="headers"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy url/i }));

    expect(writeText).toHaveBeenCalledWith(detail.url);
  });

  test("keeps the copy-url quick action on one line", () => {
    render(
      <SessionDetailPanel
        detail={detail}
        activeTab="headers"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /copy url/i }).className).toContain("whitespace-nowrap");
  });

  test("uses a localized close label for the detail dismiss action", () => {
    render(
      <SessionDetailPanel
        detail={detail}
        activeTab="headers"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  test("renders text/x-component responses as raw safe text", () => {
    render(
      <SessionDetailPanel
        detail={{
          ...detail,
          responseHeaders: [["content-type", "text/x-component"]],
          responseBody: '{"escaped":"keep-raw"}',
          contentType: "text/x-component",
        }}
        activeTab="response"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('{"escaped":"keep-raw"}')).toBeInTheDocument();
  });

  test("renders readable text content types as raw text even when control characters are present", () => {
    const responseBody = "hello\u0007world\u0007with\u0007control\u0007chars";
    const { container } = render(
      <SessionDetailPanel
        detail={{
          ...detail,
          responseHeaders: [["content-type", "text/plain; charset=utf-8"]],
          responseBody,
          contentType: "text/plain; charset=utf-8",
        }}
        activeTab="response"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText(/binary data/i)).not.toBeInTheDocument();
    expect(container.querySelector("pre")?.textContent).toBe(responseBody);
  });

  test("renders base64-encoded json responses as text when the content type is readable", () => {
    const responseBody = '{"message":"hello"}';
    const { container } = render(
      <SessionDetailPanel
        detail={{
          ...detail,
          responseHeaders: [["content-type", "application/json; charset=utf-8"]],
          responseBody: btoa(responseBody),
          responseBodyEncoding: "base64",
          contentType: "application/json; charset=utf-8",
        }}
        activeTab="response"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText(/binary data/i)).not.toBeInTheDocument();
    expect(container.querySelector("pre")?.textContent).toContain('"message": "hello"');
  });

  test("keeps base64 text responses as binary when the bytes are not valid utf-8", () => {
    const invalidUtf8Base64 = btoa(String.fromCharCode(0xff, 0xfe, 0xfd, 0xfc));

    render(
      <SessionDetailPanel
        detail={{
          ...detail,
          responseHeaders: [["content-type", "text/css"]],
          responseBody: invalidUtf8Base64,
          responseBodyEncoding: "base64",
          contentType: "text/css",
        }}
        activeTab="response"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/binary data/i)).toBeInTheDocument();
  });

  test("falls back to no-preview when response preview rendering throws", () => {
    render(
      <SessionDetailPanel
        detail={{
          ...detail,
          responseHeaders: [["content-type", "application/octet-stream"]],
          responseBody: "%%%not-base64%%%",
          responseBodyEncoding: "base64",
          contentType: "application/octet-stream",
        }}
        activeTab="response"
        onTabChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("No preview available")).toBeInTheDocument();
  });
});
