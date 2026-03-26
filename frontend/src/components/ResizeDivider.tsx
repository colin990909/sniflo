import { cn } from "@/lib/utils";
import { useResizeDrag } from "@/hooks/use-resize-drag";

interface ResizeDividerProps {
  direction: "horizontal" | "vertical";
  currentSize: number;
  min: number;
  max: number | (() => number);
  onResize: (size: number) => void;
  className?: string;
}

/**
 * Draggable divider bar for resizable panels.
 * "horizontal" = vertical bar between left/right panels (col-resize)
 * "vertical" = horizontal bar between top/bottom panels (row-resize)
 */
export function ResizeDivider({
  direction,
  currentSize,
  min,
  max,
  onResize,
  className,
}: ResizeDividerProps) {
  const onMouseDown = useResizeDrag(direction, currentSize, { min, max, onResize });

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "resize-divider resize-divider-short-handle shrink-0",
        direction === "horizontal"
          ? "w-5 cursor-col-resize resize-divider-h"
          : "h-5 cursor-row-resize resize-divider-v",
        className
      )}
    />
  );
}
