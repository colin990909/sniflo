import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Plus } from "lucide-react";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { EmptyState } from "@/components/EmptyState";
import { PageToolbar } from "@/components/PageToolbar";
import { ResizeDivider } from "@/components/ResizeDivider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RulesPanel } from "./RulesPanel";
import { BreakpointEditor } from "./BreakpointEditor";

const MIN_EDITOR_HEIGHT = 120;
const MIN_RULES_HEIGHT = 60;

export function BreakpointsPage() {
  const { t } = useTranslation();
  const { isEnabled, setEnabled, addRule, currentExchange, pendingCount, rules } =
    useBreakpointStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(300);

  const handleAddRule = () => {
    addRule({
      id: crypto.randomUUID(),
      host: "",
      path: "",
      method: "",
      phase: "both",
      enabled: true,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <PageToolbar>
        <div className="mr-2 flex items-center gap-3">
          <div className="workspace-icon">
            <Pause size={18} />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {t("breakpoint.title")}
          </h1>
        </div>

        <Switch
          checked={isEnabled}
          onCheckedChange={setEnabled}
          className="data-[state=checked]:bg-breakpoint"
          title={t("breakpoint.enableToggle")}
        />
        <span className="text-[11px] text-muted-foreground">
          {t("breakpoint.enableToggle")}
        </span>

        <Separator orientation="vertical" className="mx-1 h-4" />

        <Button
          onClick={handleAddRule}
          variant="ghost"
          size="icon-sm"
          title={t("breakpoint.addRule")}
          className="hover:bg-breakpoint/10 hover:text-breakpoint"
        >
          <Plus size={14} />
        </Button>

        {pendingCount > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Badge variant="breakpoint">
              {t("breakpoint.pendingCount", { count: pendingCount })}
            </Badge>
          </>
        )}
      </PageToolbar>

      <div ref={contentRef} className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
        {rules.length === 0 && !currentExchange ? (
          <EmptyState
            icon={<Pause size={32} />}
            title={t("breakpoint.noRules")}
            subtitle={t("breakpoint.noRulesHint")}
          />
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="glass-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)]">
                <RulesPanel />
              </div>
            </div>

            {currentExchange && (
              <>
                <ResizeDivider
                  direction="vertical"
                  currentSize={editorHeight}
                  min={MIN_EDITOR_HEIGHT}
                  max={() => (contentRef.current?.clientHeight ?? 600) - MIN_RULES_HEIGHT}
                  onResize={setEditorHeight}
                />
                <div className="glass-card mt-2.5 flex shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)]" style={{ height: editorHeight }}>
                  <BreakpointEditor />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
