import { type ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[var(--space-4)] px-[var(--space-6)] py-[calc(var(--space-5)+var(--space-5))] text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] border border-border bg-card text-primary shadow-[var(--panel-shadow)]">
        {icon}
      </div>
      <div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {subtitle && (
          <p className="mt-[var(--space-2)] max-w-sm text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="mt-[var(--space-1)]">{action}</div>}
    </div>
  );
}
