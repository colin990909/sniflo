import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, ScrollText } from "lucide-react";
import { useScriptStore } from "@/stores/script-store";
import { DataTableHeader } from "@/components/DataTableHeader";

const LOG_COLS = "16px 80px 56px minmax(0,1fr) minmax(0,200px) 48px";

export function ScriptLogPanel() {
  const { t } = useTranslation();
  const recentLogs = useScriptStore((s) => s.recentLogs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("script.executionLog")}
        </p>
      </div>
      <DataTableHeader columns={LOG_COLS}>
        <ScrollText size={10} />
        <span>{t("script.name")}</span>
        <span>{t("script.phase.both")}</span>
        <span>URL</span>
        <span>{t("script.executionLog")}</span>
        <span className="text-right">ms</span>
      </DataTableHeader>

      <div className="flex-1 overflow-y-auto">
        {recentLogs.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            {t("script.noLogs")}
          </p>
        ) : (
          recentLogs.map((log, i) => (
            <div
              key={`${log.scriptId}-${i}`}
              className={`grid items-center px-3 text-[11px] font-mono ${
                log.success ? "" : "bg-destructive/5"
              } ${i % 2 === 1 ? "bg-background/40" : ""}`}
              style={{ gridTemplateColumns: LOG_COLS, minHeight: 34 }}
            >
              {log.success ? (
                <CheckCircle size={10} className="text-green-500" />
              ) : (
                <XCircle size={10} className="text-destructive" />
              )}
              <span className="truncate text-muted-foreground">
                {log.scriptName}
              </span>
              <span className="text-muted-foreground">
                {log.phase}
              </span>
              <span className="truncate text-foreground/80">
                {log.url}
              </span>
              <span className="truncate text-muted-foreground">
                {log.errorMessage
                  ? log.errorMessage
                  : log.logs.length > 0
                    ? log.logs.join(" | ")
                    : ""}
              </span>
              <span className="text-right text-muted-foreground">
                {log.durationMs}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
