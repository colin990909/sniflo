import { useEffect, useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, MessageSquare, Pencil, Download, Search } from "lucide-react";
import type { ConversationSummary } from "@/stores/ai-store";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

function formatRelativeTime(dateStr: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t("ai.history.justNow");
  if (diffMin < 60) return t("ai.history.minutesAgo", { count: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t("ai.history.hoursAgo", { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return t("ai.history.daysAgo", { count: diffDays });
  return date.toLocaleDateString();
}

function ConversationIcon({ conversationId, primaryHost }: { conversationId: string; primaryHost: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [primaryHost]);
  if (primaryHost && !imageFailed) {
    return (
      <img
        src={`https://${primaryHost}/favicon.ico`}
        alt=""
        data-testid={`conversation-favicon-${conversationId}`}
        className="h-4 w-4 shrink-0 rounded-sm"
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <span
      data-testid={`conversation-fallback-icon-${conversationId}`}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-muted/60 text-muted-foreground/70"
    >
      <MessageSquare size={10} />
    </span>
  );
}

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  currentConversationId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: (id: string) => void;
}

export function ConversationSidebar({
  conversations, currentConversationId,
  onSelect, onNew, onDelete, onRename, onExport,
}: ConversationSidebarProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const commitRename = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="conv-sidebar flex w-60 shrink-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 pt-3 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{t("ai.history.title")}</span>
        <Button onClick={onNew} variant="ghost" size="icon-sm" className="h-6 w-6" title={t("ai.history.newChat")}>
          <Plus size={13} />
        </Button>
      </div>

      <div className="border-b border-border/30 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1">
          <Search size={11} className="shrink-0 text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("ai.history.search")}
            className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
            <MessageSquare size={20} className="text-muted-foreground/30" />
            <p className="text-[11px] text-muted-foreground/60">{t("ai.history.noConversations")}</p>
            <p className="text-[10px] text-muted-foreground/40">{t("ai.history.noConversationsHint")}</p>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((conv) => {
              const isCurrent = conv.id === currentConversationId;
              const isEditing = editingId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group relative mx-1 mb-0.5 rounded-md transition-colors ${
                    isCurrent
                      ? "bg-primary/10 ring-1 ring-primary/20"
                      : "hover:bg-muted/30"
                  }`}
                >
                  <button
                    onClick={() => !isEditing && onSelect(conv.id)}
                    className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
                  >
                    <ConversationIcon conversationId={conv.id} primaryHost={conv.primaryHost} />
                    <span className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded bg-background px-1 text-[11px] leading-snug text-foreground ring-1 ring-primary/30 focus:outline-none"
                        />
                      ) : (
                        <span
                          className={`line-clamp-2 block text-[11px] leading-snug ${
                            isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                          }`}
                          onDoubleClick={(e) => { e.stopPropagation(); startRename(conv); }}
                        >
                          {conv.title || t("ai.history.newChat")}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[10px] text-muted-foreground/50">
                        {formatRelativeTime(conv.updatedAt, t)}
                      </span>
                    </span>
                  </button>

                  <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(conv); }}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground"
                      title={t("ai.history.rename")}
                    >
                      <Pencil size={9} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onExport(conv.id); }}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-foreground"
                      title={t("ai.history.export")}
                    >
                      <Download size={9} />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title={t("ai.history.deleteConfirm")}
                        >
                          <Trash2 size={9} />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("ai.history.deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>{t("ai.history.deleteDescription")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(conv.id)}>{t("common.delete")}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
