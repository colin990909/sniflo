import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Network, Trash2, Send, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore, type SessionDetail } from "@/stores/app-store";
import { useAIStore } from "@/stores/ai-store";
import { EmptyState } from "@/components/EmptyState";
import { PageToolbar } from "@/components/PageToolbar";
import { DataTableHeader } from "@/components/DataTableHeader";
import { ResizeDivider } from "@/components/ResizeDivider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SessionDetailPanel, getStatusColor, type DetailTab } from "./SessionDetailPanel";

// ─── Types & Constants ───────────────────────────────────

type RequestType = "all" | "xhr" | "doc" | "js" | "css" | "img" | "font" | "ws" | "other";

const HOST_COLORS = [
  "#3B82F6", "#EF4444", "#22C55E", "#F97316",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F59E0B",
  "#06B6D4", "#84CC16",
];

const TYPE_FILTERS: { key: RequestType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "xhr", label: "Fetch/XHR" },
  { key: "doc", label: "Doc" },
  { key: "js", label: "JS" },
  { key: "css", label: "CSS" },
  { key: "img", label: "Img" },
  { key: "font", label: "Font" },
  { key: "ws", label: "WS" },
  { key: "other", label: "Other" },
];

const TABLE_COLS = "minmax(0,1fr) 50px 56px 140px 56px";
const ROW_HEIGHT = 22;
const MIN_PANEL_HEIGHT = 120;
const MIN_TABLE_HEIGHT = 80;

// ─── Helpers ─────────────────────────────────────────────

function getHostColor(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) {
    hash = ((hash << 5) - hash) + host.charCodeAt(i);
    hash |= 0;
  }
  return HOST_COLORS[Math.abs(hash) % HOST_COLORS.length];
}

function getHostLetter(host: string): string {
  return host.replace(/^www\./, "")[0]?.toUpperCase() ?? "?";
}

function getPathFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function getRequestType(contentType?: string, url?: string, method?: string, headers?: [string, string][]): Exclude<RequestType, "all"> {
  const upgradeHeader = headers?.find(([k]) => k.toLowerCase() === "upgrade")?.[1]?.toLowerCase();
  if (upgradeHeader === "websocket" || url?.startsWith("ws://") || url?.startsWith("wss://")) return "ws";
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes("event-stream")) return "xhr";
    if (ct.includes("json") || ct.includes("xml") || ct.includes("form-urlencoded") || ct.includes("grpc")) return "xhr";
    if (ct.includes("html")) return "doc";
    if (ct.includes("javascript") || ct.includes("ecmascript")) return "js";
    if (ct.includes("css")) return "css";
    if (ct.includes("image")) return "img";
    if (ct.includes("font") || ct.includes("woff") || ct.includes("ttf")) return "font";
  }
  if (url) {
    const path = url.split("?")[0].toLowerCase();
    if (path.endsWith(".js") || path.endsWith(".mjs")) return "js";
    if (path.endsWith(".css")) return "css";
    if (path.endsWith(".html") || path.endsWith(".htm")) return "doc";
    if (/\.(png|jpe?g|gif|svg|webp|ico|avif)$/.test(path)) return "img";
    if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return "font";
  }
  if (method === "CONNECT") return "other";
  return "xhr";
}

function sessionToCurl(detail: SessionDetail): string {
  const parts = [`curl '${detail.url}'`];
  if (detail.method !== "GET") parts.push(`-X ${detail.method}`);
  for (const [k, v] of detail.requestHeaders) {
    parts.push(`-H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  }
  if (detail.requestBody) {
    parts.push(`--data-raw '${detail.requestBody.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(" \\\n  ");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("input, textarea, [contenteditable='true']") !== null;
}

// ─── Main Component ──────────────────────────────────────

export function SessionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useAppStore((s) => s.sessions);
  const selectedSessionIds = useAppStore((s) => s.selectedSessionIds);
  const anchorSessionId = useAppStore((s) => s.anchorSessionId);
  const setSessionSelection = useAppStore((s) => s.setSessionSelection);
  const setDraftAttachedSessionIds = useAIStore((s) => s.setDraftAttachedSessionIds);
  const clearSessions = useAppStore((s) => s.clearSessions);
  const anchorSession = sessions.find((s) => s.id === anchorSessionId);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<RequestType>("all");
  const [detailTab, setDetailTab] = useState<DetailTab>("headers");
  const [detailHeight, setDetailHeight] = useState(300);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);

  const isDraggingRows = useRef(false);
  const dragStartIdx = useRef<number>(-1);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) => s.host.toLowerCase().includes(q) || (s.detail?.url ?? s.title).toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") {
      result = result.filter(
        (s) => getRequestType(s.detail?.contentType, s.detail?.url, s.detail?.method, s.detail?.requestHeaders) === typeFilter,
      );
    }
    return result;
  }, [sessions, searchQuery, typeFilter]);

  // ── Virtual scroller ──
  const virtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  // ── Selection helpers ──
  const selectSingle = useCallback(
    (id: string) => setSessionSelection(new Set([id]), id),
    [setSessionSelection],
  );

  const toggleSelect = useCallback(
    (id: string) => {
      const next = new Set(selectedSessionIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const anchor = next.size > 0 ? (next.has(anchorSessionId ?? "") ? anchorSessionId : id) : null;
      setSessionSelection(next, anchor);
    },
    [selectedSessionIds, anchorSessionId, setSessionSelection],
  );

  const rangeSelect = useCallback(
    (id: string) => {
      if (!anchorSessionId) { selectSingle(id); return; }
      const aIdx = filteredSessions.findIndex((s) => s.id === anchorSessionId);
      const tIdx = filteredSessions.findIndex((s) => s.id === id);
      if (aIdx === -1 || tIdx === -1) { selectSingle(id); return; }
      const [lo, hi] = aIdx < tIdx ? [aIdx, tIdx] : [tIdx, aIdx];
      setSessionSelection(new Set(filteredSessions.slice(lo, hi + 1).map((s) => s.id)), anchorSessionId);
    },
    [anchorSessionId, filteredSessions, selectSingle, setSessionSelection],
  );

  // ── Row mouse events ──
  const handleRowMouseDown = (e: React.MouseEvent, id: string, index: number) => {
    if (e.button !== 0) return;
    contentRef.current?.focus();
    if (e.shiftKey) { e.preventDefault(); rangeSelect(id); }
    else if (e.metaKey || e.ctrlKey) { e.preventDefault(); toggleSelect(id); }
    else {
      selectSingle(id);
      isDraggingRows.current = true;
      dragStartIdx.current = index;
      document.body.style.userSelect = "none";
    }
  };

  const handleRowMouseEnter = (index: number) => {
    if (!isDraggingRows.current || dragStartIdx.current < 0) return;
    const [lo, hi] = dragStartIdx.current < index ? [dragStartIdx.current, index] : [index, dragStartIdx.current];
    const ids = new Set(filteredSessions.slice(lo, hi + 1).map((s) => s.id));
    setSessionSelection(ids, filteredSessions[dragStartIdx.current].id);
  };

  useEffect(() => {
    const up = () => {
      if (isDraggingRows.current) {
        isDraggingRows.current = false;
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // ── Context menu ──
  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    if (!selectedSessionIds.has(sessionId)) selectSingle(sessionId);
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 220), sessionId });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [contextMenu]);

  const ctxSession = contextMenu ? sessions.find((s) => s.id === contextMenu.sessionId) : null;
  const ctxCopyUrl = () => { if (ctxSession?.detail) navigator.clipboard.writeText(ctxSession.detail.url); };
  const ctxCopyCurl = () => { if (ctxSession?.detail) navigator.clipboard.writeText(sessionToCurl(ctxSession.detail)); };
  const ctxCopyResponse = () => { if (ctxSession?.detail) navigator.clipboard.writeText(ctxSession.detail.responseBody); };
  const ctxSendToAi = () => {
    setDraftAttachedSessionIds([...selectedSessionIds]);
    navigate("/ai");
  };
  const ctxSelectAll = () => { setSessionSelection(new Set(filteredSessions.map((s) => s.id)), anchorSessionId); };
  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setTypeFilter("all");
  }, []);
  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);
  const moveSelection = useCallback(
    (direction: 1 | -1, extendSelection = false) => {
      if (filteredSessions.length === 0) return;
      const currentIndex = filteredSessions.findIndex((s) => s.id === anchorSessionId);
      const fallbackIndex = direction === 1 ? 0 : filteredSessions.length - 1;
      const nextIndex = currentIndex === -1
        ? fallbackIndex
        : Math.max(0, Math.min(filteredSessions.length - 1, currentIndex + direction));
      const nextId = filteredSessions[nextIndex].id;

      if (extendSelection && anchorSessionId) {
        rangeSelect(nextId);
      } else {
        selectSingle(nextId);
      }

      virtualizer.scrollToIndex(nextIndex, { align: "auto" });
    },
    [anchorSessionId, filteredSessions, rangeSelect, selectSingle, virtualizer],
  );

  // ── Keyboard ──
  const handleTableKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      ctxSelectAll();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1, e.shiftKey);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1, e.shiftKey);
      return;
    }

    if (e.key === "Home" && filteredSessions.length > 0) {
      e.preventDefault();
      const firstId = filteredSessions[0].id;
      if (e.shiftKey && anchorSessionId) rangeSelect(firstId);
      else selectSingle(firstId);
      virtualizer.scrollToIndex(0, { align: "start" });
      return;
    }

    if (e.key === "End" && filteredSessions.length > 0) {
      e.preventDefault();
      const lastIndex = filteredSessions.length - 1;
      const lastId = filteredSessions[lastIndex].id;
      if (e.shiftKey && anchorSessionId) rangeSelect(lastId);
      else selectSingle(lastId);
      virtualizer.scrollToIndex(lastIndex, { align: "end" });
      return;
    }

    if (e.key === "Escape") {
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (searchQuery || typeFilter !== "all") {
        e.preventDefault();
        clearFilters();
        return;
      }
      if (selectedSessionIds.size > 0) {
        e.preventDefault();
        setSessionSelection(new Set<string>(), null);
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusSearch();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
        return;
      }

      if (e.key === "Escape" && !contextMenu && (searchQuery || typeFilter !== "all")) {
        e.preventDefault();
        clearFilters();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearFilters, contextMenu, focusSearch, searchQuery, typeFilter]);

  const selectedCount = selectedSessionIds.size;
  const gridStyle = { gridTemplateColumns: TABLE_COLS };
  const hasActiveFilters = searchQuery.length > 0 || typeFilter !== "all";

  return (
    <div className="flex h-full flex-col">
      {/* ─ Toolbar ─ */}
      <PageToolbar>
        <div className="mr-2 flex items-center gap-3">
          <div className="workspace-icon">
            <Network size={18} />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {t("sessions.captured.title")}
          </h1>
        </div>
        <Button
          onClick={clearSessions}
          variant="ghost"
          size="icon-sm"
          title={t("sessions.clearAll")}
          className="hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={14} />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("sessions.search.placeholder")}
          className="w-52 text-xs"
        />
        {hasActiveFilters && (
          <Button
            onClick={clearFilters}
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
            {t("action.clear")}
          </Button>
        )}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {TYPE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] transition-colors ${
                typeFilter === key
                  ? "bg-primary/12 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedCount > 1 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <span className="shrink-0 text-[11px] font-medium text-primary">{t("sessions.selected", { count: selectedCount })}</span>
            <Button
              onClick={ctxSendToAi}
              variant="outline"
              size="sm"
              className="gap-1 border-primary/25 bg-primary/8 text-foreground hover:bg-primary/12 hover:text-foreground"
            >
              <Send size={10} />
              {t("action.sendAi")}
            </Button>
          </>
        )}
        <span className="shrink-0 text-[11px] text-muted-foreground">{filteredSessions.length} / {sessions.length}</span>
      </PageToolbar>

      {/* ─ Content ─ */}
      <div ref={contentRef} data-testid="sessions-workbench" className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 outline-none" onKeyDown={handleTableKeyDown} tabIndex={0}>
        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/70">
          <DataTableHeader columns={TABLE_COLS}>
            <span>{t("sessions.table.name")}</span>
            <span>{t("sessions.table.status")}</span>
            <span>{t("sessions.table.method")}</span>
            <span>{t("sessions.table.host")}</span>
            <span>{t("sessions.table.type")}</span>
          </DataTableHeader>

          {/* Virtual rows */}
          {filteredSessions.length === 0 ? (
            <EmptyState icon={<Network size={32} />} title={sessions.length > 0 ? t("sessions.noResults") : t("sessions.noCaptures")} subtitle={sessions.length > 0 ? undefined : t("sessions.noCapturesHint")} />
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden select-none">
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((vRow) => {
                  const i = vRow.index;
                  const session = filteredSessions[i];
                  const color = getHostColor(session.host);
                  const type = getRequestType(session.detail?.contentType, session.detail?.url, session.detail?.method, session.detail?.requestHeaders);
                  const isSelected = selectedSessionIds.has(session.id);
                  const isAnchor = session.id === anchorSessionId;
                  return (
                    <div
                      key={session.id}
                      onMouseDown={(e) => handleRowMouseDown(e, session.id, i)}
                      onMouseEnter={() => handleRowMouseEnter(i)}
                      onContextMenu={(e) => handleContextMenu(e, session.id)}
                      onDoubleClick={() => setDetailTab("response")}
                      className={`absolute inset-x-0 grid cursor-default items-center px-3 text-xs transition-colors ${
                        isAnchor && isSelected
                          ? "table-row-anchor"
                          : isSelected
                            ? "table-row-selected"
                            : i % 2 === 1
                              ? "table-row-odd table-row-hover"
                              : "table-row-even table-row-hover"
                      }`}
                      style={{ top: vRow.start, height: ROW_HEIGHT, ...gridStyle }}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold" style={{ backgroundColor: color + "22", color }}>
                          {getHostLetter(session.host)}
                        </span>
                        <span className="truncate">{getPathFromUrl(session.detail?.url ?? session.title)}</span>
                      </div>
                      <span className={getStatusColor(session.detail?.statusCode ?? null)}>{session.detail?.statusCode ?? "—"}</span>
                      <span className="text-muted-foreground">{session.detail?.method ?? "—"}</span>
                      <span className="truncate text-muted-foreground">{session.host}</span>
                      <span className="text-muted-foreground">{type}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Divider + Detail */}
        {anchorSession?.detail && (
          <>
            <ResizeDivider
              direction="vertical"
              currentSize={detailHeight}
              min={MIN_PANEL_HEIGHT}
              max={() => (contentRef.current?.clientHeight ?? 600) - MIN_TABLE_HEIGHT}
              onResize={setDetailHeight}
            />
            <div style={{ height: detailHeight }} className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/80">
              <SessionDetailPanel detail={anchorSession.detail} activeTab={detailTab} onTabChange={setDetailTab} onClose={() => setSessionSelection(new Set<string>(), null)} />
            </div>
          </>
        )}
      </div>

      {/* ─ Context Menu ─ */}
      {contextMenu && (
        <div className="fixed z-50 min-w-[200px] overflow-hidden rounded-lg border border-border/60 bg-popover py-1 text-xs shadow-2xl shadow-black/40 backdrop-blur-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <CtxItem label={t("context.copyUrl")} onClick={ctxCopyUrl} />
          <CtxItem label={t("context.copyCurl")} onClick={ctxCopyCurl} />
          <CtxItem label={t("context.copyResponse")} onClick={ctxCopyResponse} />
          <div className="my-1 border-t border-border" />
          <CtxItem label={t("action.sendAi")} onClick={ctxSendToAi} />
          <div className="my-1 border-t border-border" />
          <CtxItem label={t("context.selectAll")} onClick={ctxSelectAll} shortcut="⌘A" />
        </div>
      )}
    </div>
  );
}

function CtxItem({ label, onClick, shortcut }: { label: string; onClick: () => void; shortcut?: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <span>{label}</span>
      {shortcut && <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span>}
    </button>
  );
}
