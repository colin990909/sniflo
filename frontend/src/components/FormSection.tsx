import type React from "react";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-card section-pad shadow-[var(--panel-shadow)]">
      <h3 className="mb-[var(--space-4)] text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-[var(--space-4)]">{children}</div>
    </section>
  );
}

export function FormField({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col field-gap">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
