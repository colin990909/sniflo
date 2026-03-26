import { useCallback, useRef } from "react";

type Direction = "horizontal" | "vertical";

interface ResizeDragOptions {
  /** Minimum size in pixels */
  min: number;
  /** Maximum size in pixels, or a function returning it (e.g. from a container ref) */
  max: number | (() => number);
  /** Called on every mouse move with the new size */
  onResize: (size: number) => void;
}

/**
 * Hook that encapsulates the drag-to-resize pattern used across the app.
 *
 * - "horizontal" drags along X axis (col-resize), size grows with mouse right
 * - "vertical" drags along Y axis (row-resize), size grows with mouse up (panel at bottom)
 *
 * Returns an `onMouseDown` handler to attach to the divider element.
 */
export function useResizeDrag(
  direction: Direction,
  currentSize: number,
  options: ResizeDragOptions
) {
  const sizeRef = useRef(currentSize);
  sizeRef.current = currentSize;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const dividerEl = e.currentTarget as HTMLElement;
      const startPos = direction === "horizontal" ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      const cursor = direction === "horizontal" ? "col-resize" : "row-resize";

      dividerEl.classList.add("resize-divider-dragging");
      document.body.style.userSelect = "none";
      document.body.style.cursor = cursor;

      const onMove = (ev: MouseEvent) => {
        const currentPos = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = direction === "horizontal"
          ? currentPos - startPos     // horizontal: right = bigger
          : startPos - currentPos;    // vertical: up = bigger (bottom panel grows)
        const maxVal = typeof options.max === "function" ? options.max() : options.max;
        const newSize = Math.max(options.min, Math.min(startSize + delta, maxVal));
        options.onResize(newSize);
      };

      const onUp = () => {
        dividerEl.classList.remove("resize-divider-dragging");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [direction, options.min, options.max, options.onResize]
  );

  return onMouseDown;
}
