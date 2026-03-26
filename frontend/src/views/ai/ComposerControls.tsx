import { useRef, useState, useCallback, type ReactNode } from "react";
import {
  Send, Square, ChevronDown,
  Bot, Package, Check,
} from "lucide-react";
import { useClickOutside } from "@/hooks/use-click-outside";

/* ─── Composer Dropdown ────────────────────────────────────────── */

export function ComposerDropdown({ icon, label, sublabel, children }: {
  icon: ReactNode; label: string; sublabel?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useClickOutside(ref, close, open);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-7 max-w-[220px] min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] transition-colors ${open ? "bg-muted/60 text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        {sublabel && <span className="min-w-0 max-w-[96px] truncate text-muted-foreground/60">{sublabel}</span>}
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[200px] max-w-[320px] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl shadow-black/30" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Model Selector ──────────────────────────────────────────── */

export function ModelSelector({ models, selectedModelId, runtimeName, onSelectModel, t }: {
  models: { id: string; displayName?: string | null }[];
  selectedModelId: string | null;
  runtimeName: string;
  onSelectModel: (modelId: string) => void;
  t: (key: string) => string;
}) {
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const label = selectedModel?.displayName ?? selectedModelId ?? t("ai.runtime.none");

  return (
    <ComposerDropdown icon={<Bot size={11} />} label={label} sublabel={runtimeName}>
      {models.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">{t("ai.runtime.none")}</div>
      ) : models.map((model) => (
        <button key={model.id} onClick={() => onSelectModel(model.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/50">
          {selectedModelId === model.id ? <Check size={10} className="shrink-0 text-ai" /> : <span className="w-[10px] shrink-0" />}
          <span className="font-medium text-foreground">{model.displayName ?? model.id}</span>
        </button>
      ))}
    </ComposerDropdown>
  );
}

/* ─── Skill Selector ──────────────────────────────────────────── */

export function SkillSelector({ skills, activeSkill, setActiveSkill, t }: {
  skills: { name: string }[];
  activeSkill: string | null;
  setActiveSkill: (name: string | null) => void;
  t: (key: string) => string;
}) {
  if (skills.length === 0) return null;

  return (
    <ComposerDropdown icon={<Package size={11} />} label={activeSkill ?? t("ai.skill.label")}>
      <button onClick={() => setActiveSkill(null)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/50">
        {!activeSkill ? <Check size={10} className="shrink-0 text-ai" /> : <span className="w-[10px] shrink-0" />}
        <span className="text-muted-foreground">{t("ai.skill.label")}</span>
      </button>
      {skills.map((s) => (
        <button key={s.name} onClick={() => setActiveSkill(s.name)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/50">
          {activeSkill === s.name ? <Check size={10} className="shrink-0 text-ai" /> : <span className="w-[10px] shrink-0" />}
          <span className="font-medium text-foreground">{s.name}</span>
        </button>
      ))}
    </ComposerDropdown>
  );
}

/* ─── Action Buttons ──────────────────────────────────────────── */

export function SendButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Send message"
      data-testid="ai-send-button"
      className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <Send size={12} />
    </button>
  );
}

export function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Stop generation"
      className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/90 text-white transition-colors hover:bg-red-500"
    >
      <Square size={12} />
    </button>
  );
}
