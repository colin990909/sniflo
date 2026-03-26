import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface PageToolbarProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  draggable?: boolean;
}

/**
 * Unified toolbar container for ALL page headers.
 * Padding uses spacing tokens to align with the 8px grid.
 * Includes Tauri drag region support by default.
 */
export function PageToolbar({ children, className, draggable = true, ...props }: PageToolbarProps) {
  return (
    <div
      {...props}
      data-tauri-drag-region={draggable || undefined}
      className={cn(
        "toolbar-surface flex shrink-0 items-center",
        "gap-[var(--space-2)] px-[var(--space-5)] pt-[var(--space-4)] pb-[var(--space-3)]",
        className
      )}
    >
      {children}
    </div>
  );
}
