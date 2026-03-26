import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { useScriptStore, type ScriptRule } from "@/stores/script-store";
import { DataTableHeader } from "@/components/DataTableHeader";

const LIST_COLS = "28px minmax(0,1fr) max-content 28px";

export function ScriptList() {
  const { t } = useTranslation();
  const { scripts, selectedScriptId, select, toggle, remove, isEnabled } = useScriptStore();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DataTableHeader columns={LIST_COLS}>
        <span />
        <span>{t("script.name")}</span>
        <span>{t("script.phase.both")}</span>
        <span />
      </DataTableHeader>

      <div className="flex-1 overflow-y-auto">
        {!isEnabled && scripts.length > 0 && (
          <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            {t("script.disabledWarning")}
          </div>
        )}
        {scripts.map((script, i) => (
          <ScriptRow
            key={script.id}
            script={script}
            index={i}
            isSelected={script.id === selectedScriptId}
            onSelect={() => select(script.id)}
            onToggle={(enabled) => toggle(script.id, enabled)}
            onDelete={() => remove(script.id)}
          />
        ))}
        {scripts.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            {t("script.noScripts")}
          </p>
        )}
      </div>
    </div>
  );
}

function ScriptRow({
  script,
  index,
  isSelected,
  onSelect,
  onToggle,
  onDelete,
}: {
  script: ScriptRule;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const phaseLabel =
    script.phase === "request"
      ? t("script.phase.request")
      : script.phase === "response"
        ? t("script.phase.response")
        : t("script.phase.both");

  return (
    <div
      onClick={onSelect}
      className={`group grid cursor-pointer items-center px-3 text-xs transition-colors ${
        isSelected
          ? "table-row-anchor"
          : index % 2 === 1
            ? "table-row-odd table-row-hover"
            : "table-row-even table-row-hover"
      }`}
      style={{ gridTemplateColumns: LIST_COLS, minHeight: 44 }}
    >
      <input
        type="checkbox"
        checked={script.enabled}
        onChange={(e) => {
          e.stopPropagation();
          onToggle(e.target.checked);
        }}
        className="h-3 w-3 rounded border-border accent-breakpoint"
      />

      <div className="min-w-0">
        <div className="min-w-0 truncate font-medium text-xs">{script.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <div className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
            {script.urlPattern === "*" ? "*" : script.urlPattern}
          </div>
        </div>
      </div>

      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        {phaseLabel}
      </span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t("script.deleteScript")}
        className="justify-self-end rounded p-0.5 pl-2 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:text-red-500"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
