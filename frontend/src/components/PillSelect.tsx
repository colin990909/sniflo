import { cn } from "@/lib/utils";

interface PillSelectOption<T extends string> {
  value: T;
  label: string;
}

interface PillSelectProps<T extends string> {
  options: PillSelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Pill-style segmented control for selecting one option from a small set.
 * Used for language, type, and protocol selectors.
 */
export function PillSelect<T extends string>({
  options,
  value,
  onChange,
  className,
}: PillSelectProps<T>) {
  return (
    <div className={cn("inline-flex gap-1 rounded-[var(--radius-xl)] border border-border bg-muted/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "h-8 rounded-[var(--radius-lg)] px-3 py-1.5 text-xs font-medium transition-all",
            opt.value === value
              ? "bg-card text-foreground shadow-[var(--panel-shadow)]"
              : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
