import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, XCircle, Info } from "lucide-react";

const alertBannerVariants = cva(
  "shrink-0 flex items-center gap-2 border-b px-3 py-2 text-[11px]",
  {
    variants: {
      variant: {
        warning: "border-amber-500/15 bg-amber-500/[0.04] text-amber-300/90",
        error: "border-destructive/15 bg-destructive/[0.04] text-destructive/90",
        info: "border-session/15 bg-session/[0.04] text-session/90",
      },
    },
    defaultVariants: {
      variant: "warning",
    },
  }
);

interface AlertBannerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertBannerVariants> {
  icon?: boolean;
}

/**
 * Inline alert banner for displaying warnings, errors, or info messages
 * at the top of a panel or section.
 */
export function AlertBanner({
  className,
  variant,
  icon = true,
  children,
  ...props
}: AlertBannerProps) {
  const IconComponent =
    variant === "error" ? XCircle : variant === "info" ? Info : AlertTriangle;

  return (
    <div className={cn(alertBannerVariants({ variant }), className)} {...props}>
      {icon && <IconComponent size={12} className="shrink-0" />}
      {children}
    </div>
  );
}
