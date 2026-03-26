import { useTranslation } from "react-i18next";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Phase = "both" | "request" | "response";

interface PhaseOption {
  value: Phase;
  labelKey: string;
}

interface PhaseDropdownProps {
  value: Phase;
  onChange: (phase: Phase) => void;
  /** i18n key prefix — defaults to "breakpoint" (breakpoint.phase.both, etc.) */
  keyPrefix?: string;
  /** Accent color class for the check icon */
  accentClass?: string;
}

const PHASES: Phase[] = ["both", "request", "response"];

/**
 * Shared dropdown for selecting request/response phase.
 * Used in both breakpoint rules and script rules.
 */
export function PhaseDropdown({
  value,
  onChange,
  keyPrefix = "breakpoint",
  accentClass = "text-primary",
}: PhaseDropdownProps) {
  const { t } = useTranslation();

  const options: PhaseOption[] = PHASES.map((p) => ({
    value: p,
    labelKey: `${keyPrefix}.phase.${p}`,
  }));

  const currentLabel = options.find((o) => o.value === value)?.labelKey ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground data-[state=open]:bg-muted/60 data-[state=open]:text-foreground"
        >
          <span className="truncate">{t(currentLabel)}</span>
          <ChevronDown size={10} className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="gap-2 text-[11px]"
          >
            {opt.value === value ? (
              <Check size={10} className={`shrink-0 ${accentClass}`} />
            ) : (
              <span className="w-[10px] shrink-0" />
            )}
            <span className={opt.value === value ? "font-medium text-foreground" : "text-muted-foreground"}>
              {t(opt.labelKey)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
