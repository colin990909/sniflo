import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SessionItem } from "@/stores/app-store";

/* ─── Mention Helpers ─────────────────────────────────────────── */

function getMentionSearchText(session: SessionItem): string {
  return [session.host, session.title, session.detail?.url ?? ""].join(" ").toLowerCase();
}


/** Zero-width space used as a caret landing pad next to chips. */
const ZWS = "\u200B";

function isZwsOnly(node: Node | null): boolean {
  return node instanceof Text && (node.textContent ?? "").replace(/\u200B/g, "") === "";
}

function stripZws(text: string): string {
  return text.replace(/\u200B/g, "");
}

function readDraftText(root: HTMLElement): string {
  const parts: string[] = [];
  for (const node of root.childNodes) {
    if (node instanceof Text) {
      parts.push(stripZws(node.textContent ?? ""));
    } else if (node instanceof HTMLElement) {
      if (node.dataset.tokenId) continue;
      if (node.tagName === "BR") { parts.push("\n"); continue; }
      // Nested block (line break in contentEditable)
      if (node.tagName === "DIV" || node.tagName === "P") {
        parts.push("\n");
        parts.push(stripZws(node.textContent ?? ""));
      }
    }
  }
  return parts.join("").replace(/\u00A0/g, " ").replace(/^\n+|\n+$/g, "");
}

function readTokenIds(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-token-id]"))
    .map((el) => el.dataset.tokenId ?? "")
    .filter(Boolean);
}

function createChipNode(session: SessionItem): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.dataset.tokenId = session.id;
  chip.contentEditable = "false";
  chip.className = "mx-0.5 inline-flex max-w-[180px] items-center gap-0.5 rounded-md bg-primary/8 py-[3px] pr-1 pl-1.5 align-baseline leading-none ring-1 ring-primary/15";

  const label = document.createElement("span");
  label.className = "truncate whitespace-nowrap text-[11px] font-medium leading-none text-primary";
  label.textContent = `@${session.host}`;
  chip.appendChild(label);

  const btn = document.createElement("span");
  btn.className = "chip-remove flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-0.5 text-primary/40 transition-colors hover:bg-primary/10 hover:text-primary";
  btn.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  chip.appendChild(btn);

  return chip;
}

function buildEditorDom(
  root: HTMLElement,
  tokenIds: string[],
  draft: string,
  sessionMap: Map<string, SessionItem>,
) {
  const frag = document.createDocumentFragment();
  for (const id of tokenIds) {
    const session = sessionMap.get(id);
    if (!session) continue;
    frag.appendChild(createChipNode(session));
    frag.appendChild(document.createTextNode(ZWS));
  }
  if (draft) {
    frag.appendChild(document.createTextNode(draft));
  } else if (tokenIds.length === 0) {
    // Ensure there's at least a text node for caret
    frag.appendChild(document.createTextNode(""));
  }
  root.replaceChildren(frag);
}

function moveCaretToEnd(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getMentionMatch(root: HTMLElement): { query: string; range: Range } | null {
  const sel = window.getSelection();
  if (!sel?.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return null;
  if (sel.anchorNode instanceof HTMLElement && sel.anchorNode.closest("[data-token-id]")) return null;

  let textNode: Text | null = null;
  let offset = 0;

  if (sel.anchorNode instanceof Text) {
    textNode = sel.anchorNode;
    offset = sel.anchorOffset;
  } else if (sel.anchorNode instanceof HTMLElement) {
    const prev = sel.anchorNode.childNodes[sel.anchorOffset - 1];
    if (prev instanceof Text) { textNode = prev; offset = prev.textContent?.length ?? 0; }
  }
  if (!textNode) return null;

  const before = stripZws(textNode.textContent?.slice(0, offset) ?? "");
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;

  const range = document.createRange();
  range.setStart(textNode, offset - m[0].length);
  range.setEnd(textNode, offset);
  return { query: m[2], range };
}

function getMethodStyle(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":    return "bg-blue-500/10 text-blue-400";
    case "POST":   return "bg-green-500/10 text-green-400";
    case "PUT":    return "bg-orange-500/10 text-orange-400";
    case "PATCH":  return "bg-purple-500/10 text-purple-400";
    case "DELETE": return "bg-red-500/10 text-red-400";
    default:       return "bg-muted/40 text-muted-foreground";
  }
}

function getStatusStyle(code: number): string {
  if (code < 300) return "text-green-500";
  if (code < 400) return "text-yellow-500";
  if (code < 500) return "text-orange-500";
  return "text-red-500";
}

/* ─── Composer Editor ─────────────────────────────────────────── */

export function ComposerEditor({
  draft,
  allSessions,
  selectedSessionIds,
  placeholder,
  disabled,
  onDraftChange,
  onSelectedSessionIdsChange,
  onSubmit,
  onNavigateHistory,
}: {
  draft: string;
  allSessions: SessionItem[];
  selectedSessionIds: Set<string>;
  placeholder: string;
  disabled: boolean;
  onDraftChange: (draft: string) => void;
  onSelectedSessionIdsChange: (tokenIds: string[]) => void;
  onSubmit: () => void;
  onNavigateHistory: (direction: "up" | "down") => string | null;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionRangeRef = useRef<Range | null>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [editorTokenIds, setEditorTokenIds] = useState<string[]>([]);

  const sessionMap = useMemo(
    () => new Map(allSessions.map((s) => [s.id, s])),
    [allSessions],
  );

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const selected = new Set(editorTokenIds);
    const q = mentionQuery.trim().toLowerCase();
    return allSessions
      .filter((s) => !selected.has(s.id))
      .filter((s) => (q ? getMentionSearchText(s).includes(q) : true))
      .slice(0, 8);
  }, [mentionQuery, allSessions, editorTokenIds]);

  useEffect(() => {
    if (activeMentionIndex >= mentionCandidates.length) setActiveMentionIndex(0);
  }, [activeMentionIndex, mentionCandidates.length]);

  // Scroll active mention item into view when navigating with keyboard
  useEffect(() => {
    const list = mentionListRef.current;
    if (!list) return;
    const activeEl = list.children[activeMentionIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeMentionIndex]);

  const isEmpty = !draft.trim() && editorTokenIds.length === 0;

  const closeMention = useCallback(() => {
    mentionRangeRef.current = null;
    setMentionQuery(null);
    setActiveMentionIndex(0);
  }, []);

  const updateMention = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || document.activeElement !== ed) { closeMention(); return; }
    const m = getMentionMatch(ed);
    if (!m) { closeMention(); return; }
    mentionRangeRef.current = m.range;
    if (mentionQuery !== m.query) setActiveMentionIndex(0);
    setMentionQuery(m.query);
  }, [closeMention, mentionQuery]);

  const syncFromDom = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const ids = readTokenIds(ed);
    setEditorTokenIds(ids);
    onDraftChange(readDraftText(ed));
    onSelectedSessionIdsChange(ids);
  }, [onDraftChange, onSelectedSessionIdsChange]);

  // Sync DOM when props change externally (e.g., clear on send)
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const curDraft = readDraftText(ed);
    const curIds = readTokenIds(ed);
    const idsMatch = curIds.length === selectedSessionIds.size && curIds.every((id) => selectedSessionIds.has(id));
    if (idsMatch && curDraft === draft) { setEditorTokenIds(curIds); return; }

    const ordered = curIds.filter((id) => selectedSessionIds.has(id));
    for (const s of allSessions) {
      if (selectedSessionIds.has(s.id) && !ordered.includes(s.id)) ordered.push(s.id);
    }

    isSyncingRef.current = true;
    buildEditorDom(ed, ordered, draft, sessionMap);
    setEditorTokenIds(ordered);
    if (document.activeElement === ed) moveCaretToEnd(ed);
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, [allSessions, draft, selectedSessionIds, sessionMap]);

  const insertMention = useCallback((session: SessionItem) => {
    const ed = editorRef.current;
    const range = mentionRangeRef.current;
    if (!ed || !range) return;
    isSyncingRef.current = true;
    range.deleteContents();
    const chip = createChipNode(session);
    const trailing = document.createTextNode(ZWS);
    range.insertNode(trailing);
    range.insertNode(chip);
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.setStartAfter(trailing);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    isSyncingRef.current = false;
    syncFromDom();
    closeMention();
    ed.focus();
  }, [closeMention, syncFromDom]);

  // Handle click on chip X button (event delegation)
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const removeBtn = target.closest(".chip-remove");
    if (!removeBtn) return;
    const chip = removeBtn.closest<HTMLElement>("[data-token-id]");
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    // Remove chip + its trailing ZWS
    const nextSibling = chip.nextSibling;
    if (nextSibling && isZwsOnly(nextSibling)) nextSibling.remove();
    chip.remove();
    syncFromDom();
    editorRef.current?.focus();
  }, [syncFromDom]);

  const handleInput = useCallback(() => {
    if (isSyncingRef.current) return;
    syncFromDom();
    updateMention();
  }, [syncFromDom, updateMention]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
    if (nativeEvent.isComposing === true || nativeEvent.keyCode === 229) return;

    // Mention picker
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveMentionIndex((i) => (i + 1) % mentionCandidates.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === "Enter") { e.preventDefault(); insertMention(mentionCandidates[activeMentionIndex] ?? mentionCandidates[0]); return; }
      if (e.key === "Escape") { e.preventDefault(); closeMention(); return; }
    }

    // Backspace: delete adjacent chip
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel?.isCollapsed && sel.anchorNode) {
        const ed = editorRef.current;
        if (!ed) return;
        // Check if caret is right after a chip (in a ZWS text node)
        if (sel.anchorNode instanceof Text && sel.anchorOffset <= 1 && isZwsOnly(sel.anchorNode)) {
          const prev = sel.anchorNode.previousSibling;
          if (prev instanceof HTMLElement && prev.dataset.tokenId) {
            e.preventDefault();
            sel.anchorNode.remove();
            prev.remove();
            syncFromDom();
            return;
          }
        }
        // Caret at offset 0 of a text node, check previous sibling
        if (sel.anchorNode instanceof Text && sel.anchorOffset === 0) {
          let prev: Node | null = sel.anchorNode.previousSibling;
          if (isZwsOnly(prev)) prev = prev?.previousSibling ?? null;
          if (prev instanceof HTMLElement && prev.dataset.tokenId) {
            e.preventDefault();
            const zwsAfterChip = prev.nextSibling;
            if (isZwsOnly(zwsAfterChip)) zwsAfterChip?.remove();
            prev.remove();
            syncFromDom();
            return;
          }
        }
      }
    }

    // Cmd+Enter / Ctrl+Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onSubmit(); return; }

    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); return; }

    // Input history
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && isEmpty) {
      const next = onNavigateHistory(e.key === "ArrowUp" ? "up" : "down");
      if (next !== null) {
        e.preventDefault();
        onDraftChange(next);
        requestAnimationFrame(() => { if (editorRef.current) { editorRef.current.focus(); moveCaretToEnd(editorRef.current); } });
      }
    }
  };

  return (
    <div className="relative">
      <div
        ref={editorRef}
        data-testid="ai-composer-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        className={`relative h-[88px] overflow-y-auto w-full whitespace-pre-wrap break-words px-4 pt-2.5 pb-2.5 text-sm leading-6 text-foreground focus:outline-none ${disabled ? "cursor-not-allowed opacity-50" : ""} ${isEmpty ? "before:pointer-events-none before:absolute before:left-4 before:top-2.5 before:text-muted-foreground/60 before:content-[attr(data-placeholder)]" : ""}`}
        onInput={handleInput}
        onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData("text/plain"); document.execCommand("insertText", false, text); }}
        onKeyDown={handleKeyDown}
        onKeyUp={() => updateMention()}
        onClick={handleClick}
        onFocus={() => updateMention()}
        onBlur={() => { setTimeout(() => { if (document.activeElement !== editorRef.current) closeMention(); }, 100); }}
      />
      {/* Mention picker */}
      {mentionQuery !== null && (
        <div
          data-testid="ai-mention-picker"
          className="absolute inset-x-3 bottom-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-xl shadow-black/20"
        >
          {mentionCandidates.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/60">{t("ai.composer.mentionEmpty")}</div>
          ) : (
            <div ref={mentionListRef} className="max-h-44 overflow-y-auto p-0.5">
              {mentionCandidates.map((session, index) => {
                const detail = session.detail;
                const urlPath = detail?.url ? (() => { try { const u = new URL(detail.url); return u.pathname + u.search; } catch { return detail.url; } })() : null;
                return (
                  <button
                    key={session.id}
                    data-testid={`ai-mention-option-${session.id}`}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(session); }}
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors ${index === activeMentionIndex ? "bg-primary/10" : "hover:bg-muted/50"}`}
                  >
                    {detail?.method && (
                      <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase leading-none ${getMethodStyle(detail.method)}`}>
                        {detail.method}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      {session.host}{urlPath ?? ""}
                    </span>
                    {detail?.statusCode != null && (
                      <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${getStatusStyle(detail.statusCode)}`}>
                        {detail.statusCode}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
