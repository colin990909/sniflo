import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Play, X, Trash2, Search, ChevronUp, ChevronDown } from "lucide-react";
import { useBreakpointStore, type PausedExchange } from "@/stores/breakpoint-store";

const HEADER_COLS = "minmax(0,1fr) minmax(0,1fr) 28px";

export function BreakpointEditor() {
  const { t } = useTranslation();
  const { currentExchange, forward, drop } = useBreakpointStore();
  const [edited, setEdited] = useState<PausedExchange | null>(null);

  if (!currentExchange) return null;

  const exchange = edited ?? currentExchange;

  const updateField = <K extends keyof PausedExchange>(key: K, value: PausedExchange[K]) => {
    setEdited({ ...(edited ?? currentExchange), [key]: value });
  };

  const handleForward = () => {
    forward(exchange);
    setEdited(null);
  };

  const handleDrop = () => {
    drop(exchange.id);
    setEdited(null);
  };

  const isRequest = exchange.phase === "request";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isRequest
              ? "bg-session/20 text-session"
              : "bg-breakpoint/20 text-breakpoint"
          }`}
        >
          {isRequest ? t("breakpoint.requestPhase") : t("breakpoint.responsePhase")}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {exchange.method} {exchange.url}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={handleForward}
            className="flex items-center gap-1 rounded bg-green-600/15 px-2.5 py-1 text-[11px] font-medium text-green-500 transition-colors hover:bg-green-600/25"
          >
            <Play size={10} />
            {t("breakpoint.forward")}
          </button>
          <button
            onClick={handleDrop}
            className="flex items-center gap-1 rounded bg-red-600/15 px-2.5 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-600/25"
          >
            <X size={10} />
            {t("breakpoint.drop")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {/* Method + URL */}
        {isRequest && (
          <div className="mb-3 flex gap-2">
            <input
              value={exchange.method}
              onChange={(e) => updateField("method", e.target.value.toUpperCase())}
              className="w-20 rounded border border-border bg-background px-2 py-1 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={exchange.url}
              onChange={(e) => updateField("url", e.target.value)}
              className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {/* Request Headers */}
        <HeadersEditor
          title={t("breakpoint.requestHeaders")}
          headers={exchange.requestHeaders}
          disabled={!isRequest}
          onChange={(h) => updateField("requestHeaders", h)}
        />

        {/* Request Body */}
        <div className="mt-3">
          <h3 className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
            {t("breakpoint.requestBody")}
          </h3>
          <SearchableTextarea
            value={exchange.requestBody}
            onChange={(v) => updateField("requestBody", v)}
            disabled={!isRequest}
            rows={4}
          />
        </div>

        {/* Response section */}
        {!isRequest && (
          <>
            <div className="mt-3">
              <h3 className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                {t("breakpoint.statusCode")}
              </h3>
              <input
                type="number"
                value={exchange.statusCode}
                onChange={(e) => updateField("statusCode", Number(e.target.value))}
                className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="mt-3">
              <HeadersEditor
                title={t("breakpoint.responseHeaders")}
                headers={exchange.responseHeaders}
                disabled={false}
                onChange={(h) => updateField("responseHeaders", h)}
              />
            </div>

            <div className="mt-3">
              <h3 className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                {t("breakpoint.responseBody")}
              </h3>
              <SearchableTextarea
                value={exchange.responseBody}
                onChange={(v) => updateField("responseBody", v)}
                rows={12}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SearchableTextarea ──────────────────────────────────

/** Textarea with Ctrl+F / Cmd+F inline search bar. */
function SearchableTextarea({
  value,
  onChange,
  disabled,
  rows = 8,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  rows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);

  // Collect all match positions
  const matches = useMatches(value, query);
  const matchCount = matches.length;

  const jumpTo = useCallback(
    (idx: number, focusTextarea = false) => {
      const ta = textareaRef.current;
      if (!ta || matches.length === 0) return;
      const wrapped = ((idx % matches.length) + matches.length) % matches.length;
      setMatchIndex(wrapped);
      const pos = matches[wrapped];
      // Only steal focus when explicitly requested (Enter / arrow buttons),
      // not when the search query changes mid-typing.
      if (focusTextarea) ta.focus();
      ta.setSelectionRange(pos, pos + query.length);
    },
    [matches, query],
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Focus search input on next tick
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setMatchIndex(0);
  }, []);

  // Intercept Ctrl+F / Cmd+F on the wrapper
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
      }
      if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeSearch();
      }
    },
    [searchOpen, openSearch, closeSearch],
  );

  // Search bar key handlers
  const handleSearchKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        jumpTo(e.shiftKey ? matchIndex - 1 : matchIndex + 1, true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
        textareaRef.current?.focus();
      }
    },
    [jumpTo, matchIndex, closeSearch],
  );

  // Auto-jump to first match when query changes
  useEffect(() => {
    if (matches.length > 0) {
      setMatchIndex(0);
      jumpTo(0);
    }
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="relative" onKeyDown={handleKeyDown}>
      {/* Search bar */}
      {searchOpen && (
        <div className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 shadow-lg shadow-black/20">
          <Search size={12} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Search…"
            className="w-32 bg-transparent px-1 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          {query && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : "0/0"}
            </span>
          )}
          <button
            onClick={() => jumpTo(matchIndex - 1, true)}
            disabled={matchCount === 0}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={() => jumpTo(matchIndex + 1, true)}
            disabled={matchCount === 0}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={closeSearch}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

/** Return start positions of all case-insensitive matches. */
function useMatches(text: string, query: string): number[] {
  if (!query) return [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const result: number[] = [];
  let pos = 0;
  while (true) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) break;
    result.push(idx);
    pos = idx + 1;
  }
  return result;
}

// ─── HeadersEditor ───────────────────────────────────────

function HeadersEditor({
  title,
  headers,
  disabled,
  onChange,
}: {
  title: string;
  headers: [string, string][];
  disabled: boolean;
  onChange: (headers: [string, string][]) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <h3 className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">{title}</h3>
      <div className="rounded border border-border">
        {/* Header row */}
        <div
          className="grid items-center border-b border-border bg-card/60 px-2 py-1 text-[11px] font-medium text-muted-foreground select-none"
          style={{ gridTemplateColumns: HEADER_COLS }}
        >
          <span>{t("breakpoint.headerKey")}</span>
          <span>{t("breakpoint.headerValue")}</span>
          {!disabled && <span />}
        </div>

        {/* Rows */}
        {headers.map(([key, value], i) => (
          <div
            key={i}
            className="group grid items-center border-b border-border px-2 last:border-0"
            style={{ gridTemplateColumns: disabled ? "1fr 1fr" : HEADER_COLS }}
          >
            <input
              value={key}
              disabled={disabled}
              onChange={(e) => {
                const next = [...headers] as [string, string][];
                next[i] = [e.target.value, value];
                onChange(next);
              }}
              className="bg-transparent px-1 py-0.5 font-mono text-xs disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={value}
              disabled={disabled}
              onChange={(e) => {
                const next = [...headers] as [string, string][];
                next[i] = [key, e.target.value];
                onChange(next);
              }}
              className="bg-transparent px-1 py-0.5 font-mono text-xs disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {!disabled && (
              <button
                onClick={() => onChange(headers.filter((_, j) => j !== i))}
                title={t("breakpoint.deleteHeader")}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}

        {/* Add header */}
        {!disabled && (
          <div className="px-2 py-1">
            <button
              onClick={() => onChange([...headers, ["", ""]])}
              className="text-xs text-brand-primary hover:underline"
            >
              + {t("breakpoint.addHeader")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
