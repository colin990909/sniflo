import { useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Play, Save } from "lucide-react";
import { useScriptStore } from "@/stores/script-store";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhaseDropdown } from "@/components/PhaseDropdown";

export function ScriptEditor() {
  const { t } = useTranslation();
  const { scripts, selectedScriptId, update, testScript } = useScriptStore();
  const script = scripts.find((s) => s.id === selectedScriptId);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const scriptIdRef = useRef<string | null>(null);

  // Sync editor content with selected script
  useEffect(() => {
    if (!editorContainerRef.current) return;

    if (scriptIdRef.current !== (script?.id ?? null)) {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
      scriptIdRef.current = script?.id ?? null;
    }

    if (!script) {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
      return;
    }

    if (!editorViewRef.current) {
      const state = EditorState.create({
        doc: script.code,
        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          EditorView.theme({
            "&": { height: "100%", fontSize: "12px" },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      });

      editorViewRef.current = new EditorView({
        state,
        parent: editorContainerRef.current,
      });
    }
  }, [script?.id]);

  useEffect(() => {
    return () => {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
  }, []);

  const handleSave = useCallback(() => {
    if (!script || !editorViewRef.current) return;
    const code = editorViewRef.current.state.doc.toString();
    update({ ...script, code });
  }, [script, update]);

  const handleTest = useCallback(async () => {
    if (!editorViewRef.current) return;
    const code = editorViewRef.current.state.doc.toString();
    const phase = script?.phase ?? "request";
    const result = await testScript(code, phase);
    const store = useScriptStore.getState();
    store.appendLogs([{
      scriptId: script?.id ?? "test",
      scriptName: script?.name ?? "Test",
      url: "https://example.com/test",
      phase,
      success: !result.includes("error"),
      errorMessage: result.includes("error") ? result : undefined,
      durationMs: 0,
      logs: [result],
    }]);
  }, [script, testScript]);

  if (!script) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("script.selectScript")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/70 px-4 py-2.5">
          <Input
            value={script.name}
            onChange={(e) => update({ ...script, name: e.target.value })}
            className="h-8 w-40 border-border/70 bg-background text-xs shadow-none"
            placeholder={t("script.name")}
          />
          <Input
            value={script.urlPattern}
            onChange={(e) => update({ ...script, urlPattern: e.target.value })}
            className="h-8 w-64 border-border/70 bg-background font-mono text-xs shadow-none"
            placeholder={t("script.urlPattern")}
          />
          <div className="rounded-[var(--radius-lg)] border border-border/70 bg-background px-1.5 py-1 shadow-none">
            <PhaseDropdown
              value={script.phase}
              onChange={(phase) => update({ ...script, phase })}
              keyPrefix="script"
              accentClass="text-script"
            />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <Button
              onClick={handleTest}
              variant="outline"
              size="icon-sm"
              title={t("script.test")}
              aria-label={t("script.test")}
              className="gap-1 border-script/25 bg-script/8 text-foreground shadow-none hover:border-script/35 hover:bg-script/12 hover:text-foreground"
            >
              <Play size={12} />
            </Button>
            <Button
              onClick={handleSave}
              variant="outline"
              size="icon-sm"
              title={t("script.save")}
              aria-label={t("script.save")}
              className="gap-1 border-foreground/15 bg-foreground text-background shadow-none hover:border-foreground/15 hover:bg-foreground/92 hover:text-background"
            >
              <Save size={12} />
            </Button>
          </div>
      </div>

      {/* CodeMirror editor */}
      <div ref={editorContainerRef} className="flex-1 overflow-hidden bg-background/80" />
    </div>
  );
}
