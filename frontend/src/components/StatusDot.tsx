interface StatusDotProps {
  active: boolean;
  className?: string;
}

export function StatusDot({ active, className = "" }: StatusDotProps) {
  return (
    <span className={`inline-flex h-2.5 w-2.5 ${className}`}>
      <span
        className={`inline-flex h-2.5 w-2.5 rounded-full ${
          active ? "bg-primary" : "bg-muted-foreground/70"
        }`}
      />
    </span>
  );
}
