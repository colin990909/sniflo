import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCode, Plus } from "lucide-react";
import { useScriptStore } from "@/stores/script-store";
import { EmptyState } from "@/components/EmptyState";
import { PageToolbar } from "@/components/PageToolbar";
import { ResizeDivider } from "@/components/ResizeDivider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScriptList } from "./ScriptList";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptLogPanel } from "./ScriptLogPanel";
import { Switch } from "@/components/ui/switch";

const MIN_EDITOR_WIDTH = 300;
const MIN_LIST_WIDTH = 180;
const MIN_LOG_HEIGHT = 60;
const MIN_MAIN_HEIGHT = 200;

export function ScriptsPage() {
  const { t } = useTranslation();
  const { scripts, create, isEnabled, setEnabled } = useScriptStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(240);
  const [logHeight, setLogHeight] = useState(160);

  const handleNew = () => {
    create(t("script.newName"));
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <PageToolbar>
        <div className="mr-2 flex items-center gap-3">
          <div className="workspace-icon">
            <FileCode size={18} className="shrink-0" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">{t("script.title")}</h1>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={setEnabled}
          className="data-[state=checked]:bg-primary"
          title={t("script.enableToggle")}
          aria-label={t("script.enableToggle")}
        />
        <span className="text-[11px] text-muted-foreground">{t("script.enableToggle")}</span>
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="flex-1" />
        <Button
          onClick={handleNew}
          variant="outline"
          size="sm"
          className="gap-1 border-script/25 bg-script/8 text-foreground shadow-none hover:border-script/35 hover:bg-script/12 hover:text-foreground"
        >
          <Plus size={14} />
          <span>{t("script.addScript")}</span>
        </Button>
      </PageToolbar>

      <div className="flex min-h-0 flex-1 overflow-hidden px-4 py-4">
        <div
          style={{ width: listWidth }}
          className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/70"
        >
          <ScriptList />
        </div>

        <ResizeDivider
          direction="horizontal"
          currentSize={listWidth}
          min={MIN_LIST_WIDTH}
          max={() => (containerRef.current?.clientWidth ?? 800) - MIN_EDITOR_WIDTH}
          onResize={setListWidth}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {scripts.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-border/70 bg-background/70">
              <EmptyState
                icon={<FileCode size={28} />}
                title={t("script.noScripts")}
                subtitle={t("script.noScriptsHint")}
              />
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/70">
                <ScriptEditor />
              </div>

              <ResizeDivider
                direction="vertical"
                currentSize={logHeight}
                min={MIN_LOG_HEIGHT}
                max={() => (containerRef.current?.clientHeight ?? 600) - MIN_MAIN_HEIGHT}
                onResize={setLogHeight}
              />

              <div
                style={{ height: logHeight }}
                className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/70"
              >
                <ScriptLogPanel />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
