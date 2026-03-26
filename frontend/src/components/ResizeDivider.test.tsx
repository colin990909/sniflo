import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ResizeDivider } from "./ResizeDivider";

describe("ResizeDivider", () => {
  test("keeps a generous horizontal hit area while exposing the short-handle variant", () => {
    const { container } = render(
      <ResizeDivider
        direction="horizontal"
        currentSize={320}
        min={200}
        max={640}
        onResize={vi.fn()}
      />,
    );

    const divider = container.firstElementChild;

    expect(divider).not.toBeNull();
    expect(divider?.className).toContain("resize-divider-short-handle");
    expect(divider?.className).toContain("resize-divider-h");
    expect(divider?.className).toContain("w-5");
  });

  test("keeps a generous vertical hit area while exposing the short-handle variant", () => {
    const { container } = render(
      <ResizeDivider
        direction="vertical"
        currentSize={280}
        min={140}
        max={480}
        onResize={vi.fn()}
      />,
    );

    const divider = container.firstElementChild;

    expect(divider).not.toBeNull();
    expect(divider?.className).toContain("resize-divider-short-handle");
    expect(divider?.className).toContain("resize-divider-v");
    expect(divider?.className).toContain("h-5");
  });

  test("keeps a dragging state class until mouseup so the handle stays visually anchored", () => {
    const { container } = render(
      <ResizeDivider
        direction="horizontal"
        currentSize={320}
        min={200}
        max={640}
        onResize={vi.fn()}
      />,
    );

    const divider = container.firstElementChild as HTMLDivElement | null;

    expect(divider).not.toBeNull();
    expect(divider?.className).not.toContain("resize-divider-dragging");

    fireEvent.mouseDown(divider!, { clientX: 320 });

    expect(divider?.className).toContain("resize-divider-dragging");

    fireEvent.mouseUp(document);

    expect(divider?.className).not.toContain("resize-divider-dragging");
  });
});
