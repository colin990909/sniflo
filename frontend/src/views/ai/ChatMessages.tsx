import React, { useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown, ChevronRight, Pencil,
  AlertCircle, Brain, CheckCircle2, RefreshCw,
} from "lucide-react";
import type { ChatMessage } from "@/stores/ai-store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/CopyButton";
import { CodeBlock } from "./CodeBlock";

/* ─── Turn Grouping ────────────────────────────────────────────── */

export interface Turn {
  id: string;
  type: "user" | "assistant" | "system";
  messages: ChatMessage[];
}

/** Group flat messages into visual turns. All consecutive non-user/non-system
 *  messages collapse into a single assistant turn. */
export function groupIntoTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let assistantBatch: ChatMessage[] = [];

  const flushAssistant = () => {
    if (assistantBatch.length > 0) {
      turns.push({ id: assistantBatch[0].id, type: "assistant", messages: assistantBatch });
      assistantBatch = [];
    }
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flushAssistant();
      turns.push({ id: msg.id, type: "user", messages: [msg] });
    } else if (msg.role === "system") {
      flushAssistant();
      turns.push({ id: msg.id, type: "system", messages: [msg] });
    } else {
      assistantBatch.push(msg);
    }
  }
  flushAssistant();
  return turns;
}

/* ─── Empty State ──────────────────────────────────────────────── */

export function EmptyChat({ t, onPreset }: { t: (key: string) => string; onPreset: (key: string) => void }) {
  const suggestionKeys = [
    "ai.preset.requestFailure",
    "ai.preset.securityRisk",
    "ai.preset.redirectChain",
    "ai.preset.performanceSlow",
    "ai.preset.compareRequests",
    "ai.preset.summarizeTraffic",
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-5">
      <div className="w-full max-w-4xl -translate-y-8 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">{t("ai.empty.prompt")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("ai.empty.hint")}</p>
        </div>
        <div className="mx-auto mt-8 flex max-w-5xl flex-wrap justify-center gap-2.5">
          {suggestionKeys.map((key) => (
            <button
              key={key}
              onClick={() => onPreset(key)}
              className="rounded-full bg-muted/55 px-4 py-2 text-[13px] text-foreground/85 transition-colors hover:bg-muted hover:text-foreground"
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── User Message ─────────────────────────────────────────────── */

export function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit?: (msg: ChatMessage) => void }) {
  return (
    <div data-testid="chat-user-message" className="group/user relative mb-5 flex justify-end">
      {onEdit && (
        <button
          onClick={() => onEdit(message)}
          className="absolute -left-8 top-3 hidden items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground group-hover/user:flex"
          title="Edit"
        >
          <Pencil size={12} />
        </button>
      )}
      <div className="max-w-[min(75%,42rem)] rounded-2xl bg-muted/60 px-4 py-3 text-left shadow-sm ring-1 ring-border/40">
        {message.attachedSessions && message.attachedSessions.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-start gap-1.5" data-testid="chat-user-attachments">
            {message.attachedSessions.map((session) => (
              <span
                key={session.id}
                className="inline-flex max-w-[220px] items-center overflow-hidden rounded-md bg-primary/8 px-1.5 py-[3px] leading-none ring-1 ring-primary/15"
              >
                <span className="truncate whitespace-nowrap text-[11px] font-medium leading-none text-primary">
                  @{session.host}
                </span>
              </span>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{message.content}</p>
      </div>
    </div>
  );
}

/* ─── System Error ─────────────────────────────────────────────── */

export function SystemMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5">
      <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
      <p className="text-xs leading-relaxed text-red-400">{message.content}</p>
    </div>
  );
}

/* ─── Pulsing Dots ─────────────────────────────────────────────── */

export function PulsingDots({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[3px] ${className ?? ""}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] rounded-full bg-current"
          style={{
            animation: "ai-pulse-dot 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}

/* ─── Assistant Turn ───────────────────────────────────────────── */

/** Intermediate step inside the reasoning block (thought text or tool call). */
type ReasoningStep =
  | { type: "thought"; content: string }
  | { type: "tool"; call: ChatMessage; result?: ChatMessage };

export function AssistantTurn({
  messages,
  isStreaming,
  onRegenerate,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation();

  const lastMsg = messages[messages.length - 1];
  const lastAssistantHasContent = lastMsg?.role === "assistant" && !!lastMsg.content;

  // Find last toolCall index to distinguish intermediate vs final assistant text
  let lastToolCallIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "toolCall") { lastToolCallIdx = i; break; }
  }

  // Separate reasoning steps (thoughts + tools + intermediate text) from final assistant text
  const reasoningSteps: ReasoningStep[] = [];
  const assistantBlocks: { msg: ChatMessage; isLast: boolean }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "thought" && msg.content) {
      reasoningSteps.push({ type: "thought", content: msg.content });
    } else if (msg.role === "toolCall") {
      const result = messages.find((m) => m.role === "toolResult" && m.toolCallId === msg.toolCallId);
      reasoningSteps.push({ type: "tool", call: msg, result });
    } else if (msg.role === "assistant" && msg.content) {
      if (i <= lastToolCallIdx) {
        // Intermediate text before a tool call → fold into reasoning
        reasoningSteps.push({ type: "thought", content: msg.content });
      } else {
        assistantBlocks.push({ msg, isLast: msg === lastMsg });
      }
    }
  }

  const hasReasoning = reasoningSteps.length > 0;
  const hasUnresolvedTool = reasoningSteps.some(
    (s) => s.type === "tool" && !s.result,
  );
  // Reasoning is active while streaming and no final content yet
  const hasFinalContent = assistantBlocks.length > 0;
  const isReasoningActive = isStreaming && !hasFinalContent;

  // Compute full text for copy
  const fullText = assistantBlocks.map((b) => b.msg.content).join("\n\n");

  return (
    <div data-testid="chat-assistant-turn" className="mb-6">
      <div className="min-w-0 space-y-1.5">
        {(hasReasoning || (isReasoningActive && !hasReasoning)) && (
          <ReasoningBlock
            steps={reasoningSteps}
            isActive={isReasoningActive}
            hasUnresolvedTool={hasUnresolvedTool}
            t={t}
          />
        )}
        {assistantBlocks.map(({ msg, isLast }) => (
          <MarkdownBlock key={msg.id} text={msg.content} showCursor={isStreaming && isLast} />
        ))}
        {onRegenerate && !isStreaming && lastAssistantHasContent && (
          <div className="flex items-center gap-1 pt-1">
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
              title={t("ai.regenerate")}
            >
              <RefreshCw size={11} />
              <span>{t("ai.regenerate")}</span>
            </button>
            {fullText && (
              <CopyButton text={fullText} label={t("ai.message.copy")} iconSize={11} className="rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Reasoning Block (thoughts + tools unified) ──────────────── */

function ReasoningBlock({
  steps,
  isActive,
  hasUnresolvedTool,
  t,
}: {
  steps: ReasoningStep[];
  isActive: boolean;
  hasUnresolvedTool: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(isActive);
  const prevActive = useRef(isActive);
  const startTimeRef = useRef<number>(Date.now());
  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (isActive && !prevActive.current) {
      startTimeRef.current = Date.now();
      setExpanded(true);
    }
    if (!isActive && prevActive.current) {
      setElapsedSecs(Math.round((Date.now() - startTimeRef.current) / 1000));
      setExpanded(false);
    }
    prevActive.current = isActive;
  }, [isActive]);

  // Tick while active
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      setElapsedSecs(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const unresolvedToolName = hasUnresolvedTool
    ? [...steps].reverse().find((s): s is Extract<ReasoningStep, { type: "tool" }> => s.type === "tool" && !s.result)?.call.toolCallName
    : null;

  let statusText: string;
  if (isActive) {
    statusText = unresolvedToolName
      ? t("ai.agent.toolExecuting", { name: unresolvedToolName })
      : t("ai.thinking");
  } else {
    statusText = t("ai.reasoning.done", { secs: elapsedSecs });
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-primary/5"
      >
        {isActive ? (
          <PulsingDots className="text-ai/50" />
        ) : (
          <Brain size={11} className="shrink-0 text-ai/40" />
        )}
        <span className="text-[11px] text-ai/50">{statusText}</span>
        {expanded ? <ChevronDown size={10} className="text-ai/30" /> : <ChevronRight size={10} className="text-ai/30" />}
      </button>
      {expanded && (
        <div className="mt-0.5 max-h-64 overflow-y-auto rounded-md bg-primary/[0.03] px-2.5 py-1.5 space-y-1.5">
          {steps.map((step, i) => {
            if (step.type === "thought") {
              return (
                <p key={`thought-${i}`} className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground/70">
                  {step.content}
                </p>
              );
            }
            return <ToolStepInline key={step.call.id} call={step.call} result={step.result} t={t} />;
          })}
          {isActive && (
            <span className="ml-0.5 inline-block h-2.5 w-0.5 animate-pulse bg-ai/30" />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Tool Step (inline inside reasoning block) ───────────────── */

function ToolStepInline({ call, result, t }: { call: ChatMessage; result?: ChatMessage; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = !!result;

  return (
    <div className="rounded-md bg-background/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-muted/30"
      >
        {hasResult ? (
          <CheckCircle2 size={10} className="shrink-0 text-green-500/70" />
        ) : (
          <PulsingDots className="text-ai/60" />
        )}
        <span className="text-[11px] font-medium text-muted-foreground">{call.toolCallName || call.content}</span>
        {hasResult && result.content.length > 100 && (
          <span className="text-[10px] text-muted-foreground/40">{(result.content.length / 1024).toFixed(1)}KB</span>
        )}
        <span className="flex-1" />
        {expanded ? <ChevronDown size={9} className="text-muted-foreground/30" /> : <ChevronRight size={9} className="text-muted-foreground/30" />}
      </button>
      {expanded && (
        <div className="border-t border-border/20 text-[11px]">
          {call.toolInput && (
            <div className="border-b border-border/10 px-2.5 py-1.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{t("ai.tool.input")}</p>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{formatJson(call.toolInput)}</pre>
            </div>
          )}
          {result && (
            <div className="px-2.5 py-1.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{t("ai.tool.output")}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{formatJson(result.content)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Markdown Content Block ──────────────────────────────────── */

function extractTextContent(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractTextContent).join("");
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return extractTextContent(props.children);
  }
  return "";
}

export function MarkdownBlock({ text, showCursor }: { text: string; showCursor: boolean }) {
  return (
    <div className={`text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]${showCursor ? " ai-streaming-block" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => {
            const childArray = React.Children.toArray(children);
            if (childArray.length === 1 && React.isValidElement(childArray[0])) {
              const codeEl = childArray[0] as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
              const className = (codeEl.props as { className?: string })?.className ?? "";
              if (className.startsWith("language-") || codeEl.type === "code") {
                const lang = className.replace("language-", "");
                const code = extractTextContent((codeEl.props as { children?: React.ReactNode })?.children);
                if (code) {
                  return <CodeBlock code={code} language={lang || undefined} />;
                }
              }
            }
            return <pre className="my-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 text-xs leading-relaxed [overflow-wrap:anywhere]">{children}</pre>;
          },
          code: ({ className, children, ...props }) => {
            if (className?.startsWith("language-")) return <code className={className} {...props}>{children}</code>;
            return <code className="rounded bg-muted/60 px-1.5 py-0.5 text-[12px] text-primary" {...props}>{children}</code>;
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-border"><table className="w-full text-xs">{children}</table></div>
          ),
          th: ({ children }) => <th className="border-b border-border bg-muted/30 px-3 py-1.5 text-left font-medium text-muted-foreground">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/50 px-3 py-1.5">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
      {showCursor && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-ai" />}
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────── */

function formatJson(str: string): string {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}
