import { cn } from "@/lib/utils";

interface DataTableHeaderProps {
  children: React.ReactNode;
  columns: string;
  className?: string;
}

/**
 * Unified table header row with grid layout.
 * Provides consistent styling across Sessions, Rules, Scripts, and Logs tables.
 */
export function DataTableHeader({ children, columns, className }: DataTableHeaderProps) {
  return (
    <div
      className={cn(
        "table-header grid shrink-0 items-center px-[var(--space-4)] py-[10px] text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground select-none",
        className
      )}
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}
