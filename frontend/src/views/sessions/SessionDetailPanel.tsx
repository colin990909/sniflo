import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown, X } from "lucide-react";
import type { SessionDetail } from "@/stores/app-store";
import { CopyButton } from "@/components/CopyButton";

// ─── Types ───────────────────────────────────────────────

export type DetailTab = "headers" | "payload" | "response";

// ─── Exported Helpers ────────────────────────────────────

export function getStatusColor(code: number | null): string {
  if (code == null) return "text-muted-foreground";
  if (code < 300) return "text-green-500";
  if (code < 400) return "text-yellow-500";
  return "text-red-500";
}

// ─── Formatting Helpers ──────────────────────────────────

function formatJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function formatXml(xml: string): string {
  const lines = xml.replace(/(>)\s*(<)/g, "$1\n$2").split("\n");
  let indent = 0;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("</")) indent = Math.max(0, indent - 1);
      const result = "  ".repeat(indent) + trimmed;
      if (
        trimmed.startsWith("<") &&
        !trimmed.startsWith("</") &&
        !trimmed.startsWith("<?") &&
        !trimmed.startsWith("<!") &&
        !trimmed.endsWith("/>") &&
        !/^<\w[^>]*>.*<\/\w/.test(trimmed)
      ) {
        indent++;
      }
      return result;
    })
    .join("\n");
}

function formatFormUrlencoded(body: string): string {
  try {
    return [...new URLSearchParams(body).entries()]
      .map(([k, v]) => `${decodeURIComponent(k)}: ${decodeURIComponent(v)}`)
      .join("\n");
  } catch {
    return body;
  }
}

function isSafePlainTextContentType(contentType?: string): boolean {
  const ct = contentType?.toLowerCase() ?? "";
  return ct.includes("text/x-component");
}

function isReadableTextContentType(contentType?: string): boolean {
  const ct = contentType?.toLowerCase() ?? "";
  if (!ct) return false;

  const mediaType = ct.split(";")[0].trim();
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-www-form-urlencoded" ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml")
  );
}

function formatBody(body: string, contentType?: string): string {
  if (!body) return "";
  const ct = contentType?.toLowerCase() ?? "";
  if (isSafePlainTextContentType(contentType)) return body;

  if (ct.includes("json") || body.startsWith("{") || body.startsWith("[")) {
    const result = formatJson(body);
    if (result !== body) return result;
  }
  if (ct.includes("xml") || ct.includes("xhtml")) return formatXml(body);
  if (ct.includes("html") && body.includes("<")) return formatXml(body);
  if (ct.includes("form-urlencoded")) return formatFormUrlencoded(body);
  return body;
}

function getContentTypeLabel(contentType?: string): string {
  if (!contentType) return "";
  const ct = contentType.toLowerCase();
  if (ct.includes("json")) return "JSON";
  if (ct.includes("html")) return "HTML";
  if (ct.includes("xml")) return "XML";
  if (ct.includes("css")) return "CSS";
  if (ct.includes("javascript")) return "JavaScript";
  if (ct.includes("event-stream")) return "EventStream";
  if (ct.includes("form-urlencoded")) return "Form Data";
  if (ct.includes("text/plain")) return "Plain Text";
  if (ct.includes("image")) return "Image";
  return contentType.split(";")[0].trim();
}

function parseQueryParams(url: string): [string, string][] {
  try {
    return [...new URL(url).searchParams.entries()];
  } catch {
    return [];
  }
}

function getHostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isEventStream(detail: SessionDetail): boolean {
  return detail.contentType?.toLowerCase().includes("event-stream") === true;
}

interface SseEvent {
  id?: string;
  type: string;
  data: string;
}

function parseSseEvents(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of body.split(/\n\n+/)) {
    if (!block.trim()) continue;
    let id: string | undefined;
    let type = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      else if (line.startsWith("id:")) id = line.slice(3).trim();
    }
    if (dataLines.length > 0) {
      events.push({ id, type, data: dataLines.join("\n") });
    }
  }
  return events;
}

function getHeaderValue(headers: [string, string][], key: string): string | undefined {
  return headers.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
}

function formatTimestamp(timestamp: string): string {
  const numericTimestamp = timestamp.trim();
  let date: Date;

  if (/^\d+$/.test(numericTimestamp)) {
    const value = Number(numericTimestamp);
    const millis = numericTimestamp.length <= 10 ? value * 1000 : value;
    date = new Date(millis);
  } else {
    date = new Date(timestamp);
  }

  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function estimateSize(content: string, encoding?: "utf8" | "base64"): string {
  if (!content) return "0 B";
  const bytes = encoding === "base64" ? Math.floor((content.length * 3) / 4) : new TextEncoder().encode(content).length;
  return formatBytes(bytes);
}

// ─── Detail Panel ────────────────────────────────────────

export function SessionDetailPanel({
  detail,
  activeTab,
  onTabChange,
  onClose,
}: {
  detail: SessionDetail;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isSse = isEventStream(detail);
  const host = getHostFromUrl(detail.url);
  const responseType = getContentTypeLabel(detail.contentType ?? getHeaderValue(detail.responseHeaders, "content-type"));
  const requestSize = estimateSize(detail.requestBody, detail.requestBodyEncoding);
  const responseSize = estimateSize(detail.responseBody, detail.responseBodyEncoding);

  return (
    <>
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2.5">
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                {detail.method}
              </span>
              {detail.statusCode != null && (
                <span className={`rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold ${getStatusColor(detail.statusCode)}`}>
                  {detail.statusCode}
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-[13px] font-semibold text-foreground">{detail.url}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{host}</span>
              {responseType && (
                <span className="rounded bg-card px-1.5 py-0.5">{responseType}</span>
              )}
              <span className="rounded bg-card px-1.5 py-0.5">Req {requestSize}</span>
              <span className="rounded bg-card px-1.5 py-0.5">Res {responseSize}</span>
              <span className="rounded bg-card px-1.5 py-0.5">{formatTimestamp(detail.timestamp)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <CopyButton text={detail.url} label={t("detail.copyUrl")} className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground" />
            <button
              onClick={onClose}
              aria-label={t("action.close")}
              className="rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center">
          {(["headers", "payload", "response"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              data-active={activeTab === tab}
              className="detail-tab"
            >
              {tab === "response" && isSse ? t("detail.eventstream") : t(`detail.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 text-[11px]">
        {activeTab === "headers" && <HeadersContent detail={detail} />}
        {activeTab === "payload" && <PayloadContent detail={detail} />}
        {activeTab === "response" && (isSse ? <EventStreamContent detail={detail} /> : <ResponseContent detail={detail} />)}
      </div>
    </>
  );
}

// ─── Tab Contents ────────────────────────────────────────

function HeadersContent({ detail }: { detail: SessionDetail }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <CollapsibleSection title={t("detail.general")}>
        <div className="space-y-px">
          <KV label="Request URL" value={detail.url} breakAll copyable />
          <KV label="Request Method" value={detail.method} />
          {detail.statusCode != null && (
            <KV label="Status Code" value={String(detail.statusCode)} valueClassName={getStatusColor(detail.statusCode)} />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={t("detail.responseHeaders")}>
        {detail.responseHeaders.length > 0 ? (
          <div className="space-y-px">
            {detail.responseHeaders.map(([k, v], i) => (
              <KV key={i} label={k} value={v} breakAll />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground italic">{t("detail.emptyResponse")}</span>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={t("detail.requestHeaders")}>
        {detail.requestHeaders.length > 0 ? (
          <div className="space-y-px">
            {detail.requestHeaders.map(([k, v], i) => (
              <KV key={i} label={k} value={v} breakAll />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground italic">{t("detail.noPreview")}</span>
        )}
      </CollapsibleSection>
    </div>
  );
}

function PayloadContent({ detail }: { detail: SessionDetail }) {
  const { t } = useTranslation();
  const queryParams = useMemo(() => parseQueryParams(detail.url), [detail.url]);
  const requestContentType = getHeaderValue(detail.requestHeaders, "content-type");

  return (
    <div className="space-y-1">
      {queryParams.length > 0 && (
        <CollapsibleSection title={t("detail.queryParams")}>
          <div className="space-y-px">
            {queryParams.map(([k, v], i) => (
              <KV key={i} label={k} value={decodeURIComponent(v)} breakAll />
            ))}
          </div>
        </CollapsibleSection>
      )}
      <CollapsibleSection title={t("detail.body")}>
        {detail.requestBody ? (
          <BodyBlock content={detail.requestBody} contentType={requestContentType} encoding={detail.requestBodyEncoding} />
        ) : (
          <span className="text-muted-foreground italic">{t("detail.noRequestBody")}</span>
        )}
      </CollapsibleSection>
    </div>
  );
}

function ResponseContent({ detail }: { detail: SessionDetail }) {
  const { t } = useTranslation();
  const contentType = detail.contentType ?? getHeaderValue(detail.responseHeaders, "content-type");
  const typeLabel = getContentTypeLabel(contentType);

  if (!detail.responseBody) {
    return <span className="text-muted-foreground italic">{t("detail.emptyResponse")}</span>;
  }

  return (
    <div>
      {typeLabel && (
        <span className="mb-1.5 inline-block rounded bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
          {typeLabel}
        </span>
      )}
      <BodyBlock content={detail.responseBody} contentType={contentType} encoding={detail.responseBodyEncoding} />
    </div>
  );
}

function EventStreamContent({ detail }: { detail: SessionDetail }) {
  const { t } = useTranslation();
  const events = useMemo(() => parseSseEvents(detail.responseBody), [detail.responseBody]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (events.length === 0) {
    return <span className="text-muted-foreground italic">{t("detail.emptyResponse")}</span>;
  }

  return (
    <div>
      <div className="grid grid-cols-[40px_80px_1fr] gap-2 border-b border-border pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <span>Id</span>
        <span>Type</span>
        <span>Data</span>
      </div>
      {events.map((evt, i) => (
        <div key={i}>
          <button
            onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
            className={`grid w-full grid-cols-[40px_80px_1fr] gap-2 border-b border-border/50 py-1 text-left font-mono text-[11px] transition-colors ${
              expandedIndex === i ? "bg-brand-primary/10" : "hover:bg-muted/20"
            }`}
          >
            <span className="text-muted-foreground">{evt.id ?? "—"}</span>
            <span className="text-session">{evt.type}</span>
            <span className="truncate text-muted-foreground">{evt.data}</span>
          </button>
          {expandedIndex === i && (
            <div className="relative border-b border-border/50 bg-muted/10">
              <CopyButton text={evt.data} className="absolute right-1 top-1" />
              <pre className="whitespace-pre-wrap break-all p-2 pr-8 font-mono text-[11px] text-muted-foreground">
                {formatBody(evt.data)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────

const BINARY_CT_HINTS = ["image/", "audio/", "video/", "octet-stream", "gzip", "brotli", "protobuf", "wasm", "zip", "pdf"];

/** Heuristic: detect garbled UTF-8 (fallback for old data without encoding field). */
function isBinaryContent(body: string, contentType?: string): boolean {
  if (contentType && BINARY_CT_HINTS.some((t) => contentType.toLowerCase().includes(t))) return true;
  if (body.length === 0) return false;
  const n = Math.min(body.length, 512);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = body.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xFFFD) bad++;
  }
  return bad / n > 0.1;
}

function isImageType(contentType?: string): boolean {
  return !!contentType && contentType.toLowerCase().startsWith("image/");
}

function base64ToHexDump(b64: string, maxBytes = 256): string {
  const raw = atob(b64.slice(0, Math.ceil((maxBytes * 4) / 3)));
  const lines: string[] = [];
  for (let offset = 0; offset < raw.length; offset += 16) {
    const chunk = raw.slice(offset, offset + 16);
    const hex = Array.from(chunk, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(chunk, (c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 && code < 0x7F ? c : ".";
    }).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (b64.length > Math.ceil((maxBytes * 4) / 3)) lines.push("...");
  return lines.join("\n");
}

function decodeBase64Text(b64: string): string | null {
  try {
    const raw = atob(b64);
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BodyBlock({ content, contentType, encoding }: { content: string; contentType?: string; encoding?: "utf8" | "base64" }) {
  const { t } = useTranslation();
  const isBase64 = encoding === "base64";
  const noPreviewFallback = <span className="text-muted-foreground italic">{t("detail.noPreview")}</span>;

  try {
    // Image preview for base64-encoded image bodies
    if (isBase64 && isImageType(contentType)) {
      const dataUri = `data:${contentType};base64,${content}`;
      const sizeEstimate = Math.floor((content.length * 3) / 4);
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{contentType}</span>
            <span className="text-[10px] text-muted-foreground">{formatBytes(sizeEstimate)}</span>
          </div>
          <img src={dataUri} alt="response preview" className="max-h-80 rounded border border-border" />
        </div>
      );
    }

    if (isBase64 && isReadableTextContentType(contentType)) {
      const decodedText = decodeBase64Text(content);
      if (decodedText != null) {
        return (
          <div className="relative">
            <CopyButton text={decodedText} className="absolute right-1 top-1 z-10" />
            <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/20 p-1.5 pr-8 font-mono text-[11px] leading-5 text-muted-foreground">
              {formatBody(decodedText, contentType)}
            </pre>
          </div>
        );
      }
    }

    // Hex dump for other binary (base64) bodies
    if (isBase64) {
      const sizeEstimate = Math.floor((content.length * 3) / 4);
      const hexDump = base64ToHexDump(content);
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {contentType && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{contentType}</span>}
            <span className="text-[10px] text-muted-foreground italic">{t("detail.binaryData", { size: formatBytes(sizeEstimate) })}</span>
          </div>
          <pre className="whitespace-pre rounded-md border border-border bg-muted/20 p-1.5 font-mono text-[10px] leading-4 text-muted-foreground">{hexDump}</pre>
        </div>
      );
    }

    // Text body (utf8) — detect old-style garbled content as fallback
    const binary = !isReadableTextContentType(contentType) && isBinaryContent(content, contentType);
    const formatted = binary ? "" : formatBody(content, contentType);

    if (binary) {
      return (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-center text-muted-foreground italic">
          {t("detail.binaryData", { size: formatBytes(content.length) })}
        </div>
      );
    }

    return (
      <div className="relative">
        <CopyButton text={content} className="absolute right-1 top-1 z-10" />
        <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/20 p-1.5 pr-8 font-mono text-[11px] leading-5 text-muted-foreground">
          {formatted}
        </pre>
      </div>
    );
  } catch {
    return noPreviewFallback;
  }
}


function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/60 px-0 py-1.5 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="pt-1.5">{children}</div>}
    </div>
  );
}

function KV({
  label,
  value,
  breakAll,
  valueClassName,
  copyable,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
  valueClassName?: string;
  copyable?: boolean;
}) {
  return (
    <div className="group flex items-start gap-2 font-mono leading-5">
      <span className="min-w-[88px] shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className={`flex-1 text-[11px] ${breakAll ? "break-all" : ""} ${valueClassName ?? ""}`}>{value}</span>
      {copyable && <CopyButton text={value} label={label} className="shrink-0 opacity-0 group-hover:opacity-100" />}
    </div>
  );
}
