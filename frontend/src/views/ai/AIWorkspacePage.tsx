import { useRef, useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot, ChevronDown, PanelLeft, Plus } from "lucide-react";
import { useAIStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { useRuntimeStore, type AIRuntimeEntry } from "@/stores/runtime-store";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/PageToolbar";
import { ConversationSidebar } from "./ConversationSidebar";
import { groupIntoTurns, EmptyChat, UserMessage, SystemMessage, AssistantTurn } from "./ChatMessages";
import { ComposerEditor } from "./ComposerEditor";
import { ModelSelector, SendButton, StopButton } from "./ComposerControls";

interface RuntimeModelDescriptor {
  id: string;
  displayName?: string | null;
}

function runtimeConfiguredModel(runtime: AIRuntimeEntry | null): string | null {
  if (!runtime || !("model" in runtime.config) || typeof runtime.config.model !== "string") {
    return null;
  }
  const model = runtime.config.model.trim();
  return model ? model : null;
}

function mergeRuntimeModels(
  models: RuntimeModelDescriptor[],
  currentModelIds: Array<string | null | undefined>,
): RuntimeModelDescriptor[] {
  const merged = [...models];

  for (const modelId of currentModelIds) {
    const normalized = modelId?.trim();
    if (!normalized || merged.some((model) => model.id === normalized)) {
      continue;
    }
    merged.unshift({ id: normalized, displayName: normalized });
  }

  return merged;
}

const AUTO_FOLLOW_THRESHOLD_PX = 80;

/* ─── Page ─────────────────────────────────────────────────────── */

export function AIWorkspacePage() {
  const { t } = useTranslation();
  const {
    messages, draftMessage, isStreaming, conversationId,
    modelOverride,
    draftAttachedSessionIds,
    conversations,
    setDraft, setDraftAttachedSessionIds, sendDraft, cancelStreaming, setModelOverride,
    newConversation, switchConversation, deleteConversation,
    renameConversation, exportConversation,
    navigateInputHistory, regenerateLastResponse, editAndResend,
  } = useAIStore();
  const runtimes = useRuntimeStore((s) => s.runtimes);
  const selectedRuntime = useRuntimeStore((s) => s.selectedRuntime);
  const isLoadingConversation = useAIStore((s) => s.isLoadingConversation);
  const sessions = useAppStore((s) => s.sessions);
  const setSessionSelection = useAppStore((s) => s.setSessionSelection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoFollowRef = useRef(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [availableModels, setAvailableModels] = useState<RuntimeModelDescriptor[]>([]);

  const turns = useMemo(() => groupIntoTurns(messages), [messages]);
  const hasRuntime = runtimes.length > 0 && selectedRuntime?.();
  const currentRuntime = selectedRuntime?.() ?? null;
  const configuredModel = runtimeConfiguredModel(currentRuntime);
  const selectedModelId = modelOverride ?? configuredModel ?? null;

  useEffect(() => {
    if (!scrollRef.current || !shouldAutoFollowRef.current) {
      return;
    }

    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [isStreaming, messages]);

  useEffect(() => {
    const runtimeId = currentRuntime?.id;
    if (!runtimeId) {
      setAvailableModels([]);
      return;
    }

    const configuredModel = runtimeConfiguredModel(currentRuntime);
    let cancelled = false;

    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<RuntimeModelDescriptor[]>("ai_runtime_list_models", {
        runtimeId,
      }))
      .then((models) => {
        if (cancelled) {
          return;
        }
        setAvailableModels(mergeRuntimeModels(models, [modelOverride, configuredModel]));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAvailableModels(mergeRuntimeModels([], [modelOverride, configuredModel]));
      });

    return () => {
      cancelled = true;
    };
  }, [currentRuntime, modelOverride]);

  const handlePreset = (presetKey: string) => {
    // presetKey is like "ai.preset.requestFailure"
    // The actual prompt is at "ai.preset.requestFailurePrompt"
    const baseKey = presetKey.split(".").pop();
    const promptKey = `ai.preset.${baseKey}Prompt`;
    const prompt = t(promptKey);
    if (prompt && prompt !== promptKey) {
      setDraft(prompt);
    }
  };

  const handleSelectModel = (modelId: string) => {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) {
      setModelOverride(null);
      return;
    }

    setModelOverride(normalizedModelId === configuredModel ? null : normalizedModelId);
  };

  const handleSelectedSessionIdsChange = (tokenIds: string[]) => {
    setDraftAttachedSessionIds(tokenIds);
    const currentSelectedSessionIds = useAppStore.getState().selectedSessionIds;
    const unchanged = tokenIds.length === currentSelectedSessionIds.size
      && tokenIds.every((id) => currentSelectedSessionIds.has(id));

    if (unchanged) {
      return;
    }

    setSessionSelection(new Set(tokenIds), tokenIds[tokenIds.length - 1] ?? null);
  };

  const handleScroll = () => {
    const panel = scrollRef.current;
    if (!panel) {
      return;
    }

    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    shouldAutoFollowRef.current = distanceFromBottom <= AUTO_FOLLOW_THRESHOLD_PX;
    setShowScrollBtn(distanceFromBottom > 200);
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <div data-testid="ai-workspace-root" className="flex h-full flex-col bg-background">
      <PageToolbar>
        <div className="mr-2 flex items-center gap-3">
          <div className="workspace-icon">
            <Bot size={18} />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {t("home.ai.title")}
          </h1>
        </div>
        <Button
          onClick={() => setShowHistory(!showHistory)}
          variant="ghost"
          size="icon-sm"
          className={showHistory ? "bg-primary/15 text-primary" : ""}
          title={t("ai.history.title")}
        >
          <PanelLeft size={14} />
        </Button>
        <div className="flex-1" />
        {!isStreaming && (
          <Button
            onClick={newConversation}
            variant="ghost"
            size="sm"
            className="gap-1.5"
            title={t("ai.history.newChat")}
          >
            <Plus size={12} />
            <span>{t("ai.history.newChat")}</span>
          </Button>
        )}
      </PageToolbar>

      <div data-testid="ai-workspace-content" className="flex min-h-0 flex-1">
        {showHistory && (
          <ConversationSidebar
            conversations={conversations}
            currentConversationId={conversationId}
            onSelect={switchConversation}
            onNew={newConversation}
            onDelete={deleteConversation}
            onRename={renameConversation}
            onExport={exportConversation}
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              data-testid="ai-scroll-panel"
              className="h-full overflow-y-auto"
              onScroll={handleScroll}
            >
              {isLoadingConversation ? (
                <div className="flex h-full items-center justify-center">
                  <span className="animate-pulse text-sm text-muted-foreground/50">{t("ai.thinking")}</span>
                </div>
              ) : messages.length === 0 ? (
                <EmptyChat t={t} onPreset={handlePreset} />
              ) : (
                <div className="mx-auto max-w-3xl px-4 py-5">
                  {turns.map((turn, i) => {
                    const isLast = i === turns.length - 1;
                    if (turn.type === "user") return <UserMessage key={turn.id} message={turn.messages[0]} onEdit={(msg) => editAndResend(msg.id)} />;
                    if (turn.type === "system") return <SystemMessage key={turn.id} message={turn.messages[0]} />;
                    return (
                      <AssistantTurn
                        key={turn.id}
                        messages={turn.messages}
                        isStreaming={isLast && isStreaming}
                        onRegenerate={isLast && !isStreaming ? regenerateLastResponse : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </div>
            {showScrollBtn && (
              <button
                onClick={scrollToBottom}
                aria-label={t("ai.scrollToBottom")}
                className="absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-card/90 text-muted-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-card hover:text-foreground"
              >
                <ChevronDown size={16} />
              </button>
            )}
          </div>

          <div className="shrink-0 border-t border-border/60 bg-card/20">
            <div className="mx-auto max-w-3xl px-4 py-3">
              <div
                data-testid="ai-composer-shell"
                className="overflow-visible rounded-[var(--radius-xl)] border border-border/60 bg-card/60 shadow-[var(--panel-shadow)] ring-1 ring-white/[0.03] transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10"
              >
                <ComposerEditor
                  draft={draftMessage}
                  allSessions={sessions}
                  selectedSessionIds={new Set(draftAttachedSessionIds)}
                  placeholder={hasRuntime ? t("ai.composer.placeholder") : t("ai.runtime.notConfigured")}
                  disabled={!hasRuntime}
                  onDraftChange={setDraft}
                  onSelectedSessionIdsChange={handleSelectedSessionIdsChange}
                  onSubmit={sendDraft}
                  onNavigateHistory={(direction) => navigateInputHistory(direction)}
                />
                <div
                  data-testid="ai-composer-controls"
                  className="flex items-center gap-1.5 px-2 py-2"
                >
                  <ModelSelector
                    models={availableModels}
                    selectedModelId={selectedModelId}
                    runtimeName={currentRuntime?.name ?? t("ai.runtime.none")}
                    onSelectModel={handleSelectModel}
                    t={t}
                  />
                  <div className="flex-1" />
                  {isStreaming ? (
                    <StopButton onClick={cancelStreaming} />
                  ) : (
                    <SendButton onClick={sendDraft} disabled={!draftMessage.trim() || !hasRuntime} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
