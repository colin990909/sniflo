import { useTranslation } from "react-i18next";
import {
  Plus, Plug, Trash2, Star, Check, Eye, EyeOff, Bot, Code2, Cloud, ChevronDown,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useRuntimeStore,
  type AIRuntimeEntry,
  type AIRuntimeType,
  type RemoteAPIProtocol,
  type ClaudeCodeLocalConfig,
  type CodexLocalConfig,
  type RemoteAPIConfig,
} from "@/stores/runtime-store";
import { EmptyState } from "@/components/EmptyState";
import { Section, FormField } from "@/components/FormSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PillSelect } from "@/components/PillSelect";
import { SettingsSectionHeader } from "@/components/SettingsSectionHeader";

interface RuntimeModelDescriptor {
  id: string;
  displayName?: string | null;
}

const PROTOCOL_OPTIONS: { value: RemoteAPIProtocol; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
];

function createDefaultConfig(runtimeType: AIRuntimeType) {
  switch (runtimeType) {
    case "claude_code_local":
      return {
        cliPath: "",
        model: "claude-sonnet-4-5",
        workingDirectory: "",
        maxContextTokens: 0,
      } satisfies ClaudeCodeLocalConfig;
    case "codex_local":
      return {
        cliPath: "",
        model: "gpt-5-codex",
        workingDirectory: "",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        maxContextTokens: 0,
      } satisfies CodexLocalConfig;
    case "remote_api":
      return {
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o",
      } satisfies RemoteAPIConfig;
  }
}

function createRuntimeEntry(runtimeType: AIRuntimeType, isDefault: boolean): AIRuntimeEntry {
  const now = new Date().toISOString();
  const name = runtimeType === "claude_code_local"
    ? "Claude Code"
    : runtimeType === "codex_local"
      ? "Codex"
      : "Remote API";

  return {
    id: crypto.randomUUID(),
    name,
    runtimeType,
    config: createDefaultConfig(runtimeType),
    isDefault,
    createdAt: now,
    updatedAt: now,
    lastHealthcheck: null,
  };
}

function runtimeLabel(runtimeType: AIRuntimeType) {
  switch (runtimeType) {
    case "claude_code_local":
      return "Claude Code";
    case "codex_local":
      return "Codex";
    case "remote_api":
      return "Remote API";
  }
}

function runtimeModel(entry: AIRuntimeEntry) {
  return "model" in entry.config && typeof entry.config.model === "string"
    ? entry.config.model
    : runtimeLabel(entry.runtimeType);
}

function runtimeReady(entry: AIRuntimeEntry) {
  if (entry.runtimeType === "remote_api") {
    const config = entry.config as RemoteAPIConfig;
    return Boolean(config.baseUrl && config.apiKey && config.model);
  }
  const config = entry.config as ClaudeCodeLocalConfig | CodexLocalConfig;
  return Boolean(config.cliPath);
}

function RuntimeGlyph({ runtimeType }: { runtimeType: AIRuntimeType }) {
  if (runtimeType === "claude_code_local") {
    return <Bot size={14} className="text-ai" />;
  }
  if (runtimeType === "codex_local") {
    return <Code2 size={14} className="text-ai" />;
  }
  return <Cloud size={14} className="text-ai" />;
}

export function AIRuntimeSettingsPage() {
  const { t } = useTranslation();
  const { runtimes, selectedRuntimeId, add, select } = useRuntimeStore();
  const selectedEntry = runtimes.find((runtime) => runtime.id === selectedRuntimeId);
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const handleAdd = (runtimeType: AIRuntimeType) => {
    add(createRuntimeEntry(runtimeType, runtimes.length === 0));
    setShowMoreOptions(false);
  };

  return (
    <div data-testid="runtime-settings-stack" className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5">
        <SettingsSectionHeader
          title={t("settings.runtimes.title")}
          description={t("settings.runtimes.description")}
        />

        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => handleAdd("claude_code_local")} variant="outline" size="sm" className="gap-2">
            <Plus size={12} className="text-ai" />
            <span>Claude Code</span>
          </Button>
          <Button onClick={() => handleAdd("codex_local")} variant="outline" size="sm" className="gap-2">
            <Plus size={12} className="text-ai" />
            <span>Codex</span>
          </Button>
          <div className="relative">
            <Button
              onClick={() => setShowMoreOptions((current) => !current)}
              variant="ghost"
              size="sm"
              className="gap-2 border border-dashed border-border text-muted-foreground"
            >
              <span>More options</span>
              <ChevronDown
                size={12}
                className={showMoreOptions ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </Button>
            {showMoreOptions && (
              <div className="absolute left-0 z-10 mt-2 w-48 rounded-[var(--radius-lg)] border border-border bg-background p-1 shadow-[var(--panel-shadow-strong)]">
                <button
                  onClick={() => handleAdd("remote_api")}
                  className="flex w-full items-center gap-2 rounded-[calc(var(--radius-lg)-4px)] px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
                >
                  <Cloud size={14} className="text-ai" />
                  <span>Remote API</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {runtimes.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t("ai.runtime.notConfigured")}
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {runtimes.map((runtime) => (
              <button
                key={runtime.id}
                onClick={() => select(runtime.id)}
                className={`group flex min-w-[220px] flex-1 items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 text-left transition-colors ${
                  runtime.id === selectedRuntimeId
                    ? "border-ai/30 bg-ai/10 ring-1 ring-ai/20"
                    : "border-border bg-background hover:bg-muted/30"
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ai/10">
                  <RuntimeGlyph runtimeType={runtime.runtimeType} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {runtime.name}
                    </span>
                    {runtime.isDefault && (
                      <Star size={10} className="shrink-0 fill-ai text-ai" />
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {runtimeModel(runtime)}
                  </p>
                </div>
                <div
                  className={`h-2 w-2 shrink-0 rounded-full ${runtimeReady(runtime) ? "bg-green-500" : "bg-amber-500"}`}
                  title={runtimeReady(runtime) ? "Ready" : "Needs configuration"}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1">
        {selectedEntry ? (
          <RuntimeEditor entry={selectedEntry} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Plug size={32} />}
              title="Select an AI runtime to edit"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeEditor({ entry }: { entry: AIRuntimeEntry }) {
  const { t } = useTranslation();
  const update = useRuntimeStore((state) => state.update);
  const setDefault = useRuntimeStore((state) => state.setDefault);
  const remove = useRuntimeStore((state) => state.remove);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<RuntimeModelDescriptor[]>([]);

  const updateRuntime = (next: AIRuntimeEntry) => {
    update({
      ...next,
      updatedAt: new Date().toISOString(),
    });
  };

  const updateConfig = (config: AIRuntimeEntry["config"]) => {
    updateRuntime({ ...entry, config });
  };

  const remoteConfig = entry.runtimeType === "remote_api" ? entry.config as RemoteAPIConfig : null;
  const localConfig = entry.runtimeType !== "remote_api"
    ? entry.config as ClaudeCodeLocalConfig | CodexLocalConfig
    : null;
  const supportsModelLoading = entry.runtimeType === "codex_local"
    || entry.runtimeType === "claude_code_local";

  useEffect(() => {
    setAvailableModels([]);
  }, [entry.id]);

  const handleTestRuntime = async () => {
    setTesting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ status: string; message: string }>("ai_runtime_test", {
        runtimeId: entry.id,
      });
      updateRuntime({
        ...entry,
        lastHealthcheck: {
          status: result.status as "passed" | "warning" | "failed",
          message: result.message,
        },
      });
      toast.success(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateRuntime({
        ...entry,
        lastHealthcheck: {
          status: "failed",
          message,
        },
      });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<RuntimeModelDescriptor[]>("ai_runtime_list_models", {
        runtimeId: entry.id,
      });
      setAvailableModels(result);
      if (remoteConfig && result.length > 0 && !result.some((model) => model.id === remoteConfig.model)) {
        updateConfig({ ...remoteConfig, model: result[0].id });
      }
      if (entry.runtimeType !== "remote_api" && localConfig && result.length > 0) {
        const currentModel = localConfig.model ?? "";
        if (!result.some((model) => model.id === currentModel)) {
          updateConfig({ ...localConfig, model: result[0].id });
        }
      }
      toast.success(result.length > 0 ? `Loaded ${result.length} models` : "No models returned");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ai/10 ring-1 ring-ai/20">
            <RuntimeGlyph runtimeType={entry.runtimeType} />
          </div>
          <div>
            <input
              value={entry.name}
              onChange={(e) => updateRuntime({ ...entry, name: e.target.value })}
              className="rounded bg-transparent text-lg font-semibold text-foreground outline-none ring-0 focus:text-primary"
            />
            <p className="text-xs text-muted-foreground">{runtimeLabel(entry.runtimeType)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleTestRuntime} variant="outline" size="sm" className="gap-1" disabled={testing}>
            {testing ? "Testing..." : "Test Environment"}
          </Button>
          {entry.isDefault ? (
            <Badge variant="ai" className="gap-1">
              <Check size={10} />
              {t("runtime.defaultBadge")}
            </Badge>
          ) : (
            <Button onClick={() => setDefault(entry.id)} variant="outline" size="sm" className="gap-1">
              <Star size={10} />
              {t("runtime.setDefault")}
            </Button>
          )}
        </div>
      </div>

      <div className="stack-base">
        {remoteConfig && (
          <Section title={t("runtime.connection")}>
            <FormField label={t("runtime.protocol")}>
              <PillSelect
                options={PROTOCOL_OPTIONS}
                value={remoteConfig.protocol}
                onChange={(value) => updateConfig({ ...remoteConfig, protocol: value as RemoteAPIProtocol })}
              />
            </FormField>
            <FormField label={t("runtime.baseUrl")}>
              <Input
                value={remoteConfig.baseUrl}
                onChange={(e) => updateConfig({ ...remoteConfig, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </FormField>
            <FormField label={t("runtime.apiKey")}>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={remoteConfig.apiKey}
                  onChange={(e) => updateConfig({ ...remoteConfig, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="pr-9"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </FormField>
            <FormField label={t("runtime.model")}>
              <Input
                value={remoteConfig.model}
                onChange={(e) => updateConfig({ ...remoteConfig, model: e.target.value })}
                placeholder="gpt-4o / claude-sonnet-4-5"
              />
            </FormField>
          </Section>
        )}

        {localConfig && (
          <Section title={t("runtime.cliSection")}>
            <FormField label={t("runtime.cliPath")}>
              <Input
                value={localConfig.cliPath ?? ""}
                onChange={(e) => updateConfig({ ...localConfig, cliPath: e.target.value })}
                placeholder={entry.runtimeType === "claude_code_local" ? "/usr/local/bin/claude" : "/usr/local/bin/codex"}
              />
            </FormField>
            <FormField label={t("runtime.model")}>
              <div className="flex items-center gap-2">
                <Input
                  value={localConfig.model ?? ""}
                  onChange={(e) => updateConfig({ ...localConfig, model: e.target.value })}
                  placeholder={entry.runtimeType === "claude_code_local" ? "claude-sonnet-4-5" : "gpt-5-codex"}
                />
                {supportsModelLoading && (
                  <Button onClick={handleFetchModels} variant="outline" size="sm" disabled={loadingModels} className="shrink-0">
                    {loadingModels ? "Loading..." : "Fetch Models"}
                  </Button>
                )}
              </div>
            </FormField>
            {availableModels.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-card/50 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Available Models
                </div>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {availableModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => updateConfig({ ...localConfig, model: model.id })}
                      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                        localConfig.model === model.id
                          ? "bg-ai/10 text-foreground"
                          : "hover:bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      <span>{model.displayName ?? model.id}</span>
                      <span className="ml-3 truncate text-[10px] text-muted-foreground">{model.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <FormField label="Working Directory">
              <Input
                value={localConfig.workingDirectory ?? ""}
                onChange={(e) => updateConfig({ ...localConfig, workingDirectory: e.target.value })}
                placeholder="/Users/colin/owner/http_proxy"
              />
            </FormField>
            <FormField label={t("runtime.maxContextTokens")} description={t("runtime.maxContextTokensHint")}>
              <Input
                type="number"
                min={0}
                step={1000}
                value={localConfig.maxContextTokens ?? 0}
                onChange={(e) => updateConfig({ ...localConfig, maxContextTokens: Math.max(0, parseInt(e.target.value) || 0) })}
                placeholder="0"
              />
            </FormField>
            {entry.lastHealthcheck?.message && (
              <p className={`text-xs ${entry.lastHealthcheck.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                {entry.lastHealthcheck.message}
              </p>
            )}
          </Section>
        )}
      </div>

      {entry.lastHealthcheck?.message && (
        <div className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
          entry.lastHealthcheck.status === "failed"
            ? "border-destructive/20 bg-destructive/5 text-destructive"
            : "border-border bg-card/40 text-muted-foreground"
        }`}
        >
          {entry.lastHealthcheck.message}
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <Button onClick={() => remove(entry.id)} variant="destructive" size="sm" className="gap-2">
          <Trash2 size={12} />
          {t("runtime.delete")}
        </Button>
      </div>
    </div>
  );
}
