import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { DataTableHeader } from "@/components/DataTableHeader";
import { AlertBanner } from "@/components/AlertBanner";
import { PhaseDropdown } from "@/components/PhaseDropdown";

const RULE_COLS = "28px minmax(0,1fr) minmax(0,1fr) 56px 80px 28px";

export function RulesPanel() {
  const { t } = useTranslation();
  const { isEnabled, rules, updateRule, removeRule } = useBreakpointStore();

  if (rules.length === 0) return null;

  return (
    <div className="flex flex-1 flex-col">
      {!isEnabled && (
        <AlertBanner variant="warning" className="border-breakpoint/20 bg-breakpoint/5 text-breakpoint">
          {t("breakpoint.disabledWarning")}
        </AlertBanner>
      )}

      <DataTableHeader columns={RULE_COLS}>
        <span />
        <span>{t("breakpoint.host")}</span>
        <span>{t("breakpoint.path")}</span>
        <span>{t("breakpoint.method")}</span>
        <span>{t("breakpoint.phase.both")}</span>
        <span />
      </DataTableHeader>

      <div className="flex-1 overflow-y-auto">
        {rules.map((rule, i) => (
          <div
            key={rule.id}
            className={`group grid items-center px-3 text-xs ${
              i % 2 === 1 ? "bg-white/[0.02]" : ""
            } hover:bg-muted/20`}
            style={{ gridTemplateColumns: RULE_COLS, height: 28 }}
          >
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => updateRule({ ...rule, enabled: e.target.checked })}
              className="h-3 w-3 rounded border-border accent-breakpoint"
            />
            <input
              value={rule.host}
              onChange={(e) => updateRule({ ...rule, host: e.target.value })}
              placeholder={t("breakpoint.anyHost")}
              className="w-full bg-transparent px-1 py-0.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={rule.path}
              onChange={(e) => updateRule({ ...rule, path: e.target.value })}
              placeholder="/*"
              className="w-full bg-transparent px-1 py-0.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={rule.method}
              onChange={(e) => updateRule({ ...rule, method: e.target.value.toUpperCase() })}
              placeholder={t("breakpoint.anyMethod")}
              className="w-full bg-transparent px-1 py-0.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <PhaseDropdown
              value={rule.phase}
              onChange={(phase) => updateRule({ ...rule, phase })}
              accentClass="text-breakpoint"
            />
            <button
              onClick={() => removeRule(rule.id)}
              title={t("breakpoint.deleteRule")}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:text-red-500"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
