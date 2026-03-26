import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Home,
  ShieldCheck,
  Settings,
  Power,
  Zap,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { useProxyStore } from "@/stores/proxy-store";
import { useAppStore, type SessionItem } from "@/stores/app-store";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { useCertStore } from "@/stores/cert-store";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/PageToolbar";

export const LIVE_WINDOW_SECONDS = 30;
const LIVE_BUCKET_SPAN_MS = 1000;
const LIVE_BUCKET_COUNT = LIVE_WINDOW_SECONDS;
const LIVE_CHART_HEIGHT = 144;
const LIVE_CHART_MIN_DOMAIN_MAX = 2;
const LIVE_CHART_Y_MIN = 0;
export const LIVE_CHART_CURVE_TYPE = "monotone";
export const LIVE_CHART_MARGIN = {
  top: 6,
  right: 4,
  left: -20,
  bottom: 10,
} as const;

type SnapshotBucket = {
  count: number;
  label: string;
  rangeLabel: string;
};

function getAlignedSnapshotWindow(now: number) {
  const latestBucketStart = Math.floor(now / LIVE_BUCKET_SPAN_MS) * LIVE_BUCKET_SPAN_MS;
  const windowStart = latestBucketStart - LIVE_BUCKET_SPAN_MS * (LIVE_BUCKET_COUNT - 1);

  return {
    latestBucketStart,
    windowStart,
    windowEndExclusive: latestBucketStart + LIVE_BUCKET_SPAN_MS,
  };
}

function createTrafficBuckets(now: number) {
  const { windowStart } = getAlignedSnapshotWindow(now);

  return Array.from({ length: LIVE_BUCKET_COUNT }, (_, index) => {
    const bucketStart = windowStart + LIVE_BUCKET_SPAN_MS * index;
    const bucketEndExclusive = bucketStart + LIVE_BUCKET_SPAN_MS;

    return {
      count: 0,
      label: formatSnapshotTime(bucketStart),
      rangeLabel: `${formatSnapshotTime(bucketStart)} - ${formatSnapshotTime(bucketEndExclusive)}`,
    };
  });
}

function formatSnapshotTime(value: number) {
  return new Date(value).toLocaleTimeString([], {
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseSessionTimestamp(timestamp: string) {
  const trimmed = timestamp.trim();

  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return trimmed.length <= 10 ? value * 1000 : value;
  }

  return Date.parse(trimmed);
}

export function buildTrafficSnapshot(sessions: SessionItem[], now: number) {
  const buckets = createTrafficBuckets(now);
  const timestamps = sessions
    .map((session) => session.detail?.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .map(parseSessionTimestamp)
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return buckets;
  }

  const { windowStart, windowEndExclusive } = getAlignedSnapshotWindow(now);

  for (const timestamp of timestamps) {
    if (timestamp < windowStart || timestamp >= windowEndExclusive) {
      continue;
    }

    const bucketIndex = Math.min(LIVE_BUCKET_COUNT - 1, Math.floor((timestamp - windowStart) / LIVE_BUCKET_SPAN_MS));

    buckets[bucketIndex].count += 1;
  }

  return buckets;
}

export function getSnapshotYAxisDomain(buckets: SnapshotBucket[]): [number, number] {
  return [
    LIVE_CHART_Y_MIN,
    Math.max(
      LIVE_CHART_MIN_DOMAIN_MAX,
      ...buckets.map((bucket) => bucket.count + 1),
    ),
  ];
}

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageToolbar className="justify-between">
        <div className="flex items-center gap-3">
          <div className="workspace-icon">
            <Home size={18} className="shrink-0" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {t("home.dashboard")}
          </h1>
        </div>
      </PageToolbar>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
          <ProxyControl />
        </div>
      </div>
    </div>
  );
}

function ProxyControl() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, lastError, listenHost, listenPort, startProxy, stopProxy } = useProxyStore();
  const sessions = useAppStore((s) => s.sessions);
  const sessionCount = sessions.length;
  const pendingCount = useBreakpointStore((s) => s.pendingCount);
  const { hasCA, isInstalled } = useCertStore();
  const { upstreamEnabled, upstreamHost, upstreamPort, corsOverrideEnabled } = useProxyStore();
  const [now, setNow] = useState(() => Date.now());
  const isStarting = status === "starting";
  const isRunning = status === "running";
  const isFailed = status === "failed";
  const trafficBuckets = buildTrafficSnapshot(sessions, now);
  const snapshotYAxisDomain = getSnapshotYAxisDomain(trafficBuckets);
  const hasTimestampedActivity = sessions.some((session) => {
    const timestamp = session.detail?.timestamp;
    return typeof timestamp === "string" && Number.isFinite(parseSessionTimestamp(timestamp));
  });
  const shouldShowTrafficTrend = isRunning || isStarting || hasTimestampedActivity;

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="hero-card overflow-hidden rounded-[var(--radius-xl)] px-5 py-4">
      <div className="z-10 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 w-full flex-1">
            <h2 className="max-w-xl text-[1.7rem] font-semibold tracking-tight text-foreground">
              {t("home.controlCenter")}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-3 self-start">
            <Button onClick={() => navigate("/settings?tab=proxy")} variant="outline" title={t("home.stats.configure")}>
              <Settings size={15} />
              <span>{t("home.stats.configure")}</span>
            </Button>
            <Button
              onClick={isRunning || isStarting ? stopProxy : startProxy}
              variant={isRunning || isStarting ? "destructive" : "default"}
              className="min-w-[148px] gap-2"
            >
              {isRunning || isStarting ? <><Power size={14} />{t("capture.stop")}</> : <><Zap size={14} />{t("capture.start")}</>}
            </Button>
          </div>
        </div>

        {(isRunning || (isFailed && lastError)) && (
          <div className="w-full">
            {isRunning && (
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {t("capture.configureClient", { address: `${listenHost}:${listenPort}` })}
              </p>
            )}
            {isFailed && lastError && (
              <p className="rounded-[var(--radius-lg)] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {lastError}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 border-t border-border/80 pt-3">
            <StatusPill
              icon={<ShieldCheck size={14} />}
              label="HTTPS"
              value={isInstalled ? t("home.stats.caInstalled") : hasCA ? t("home.stats.caGenerated") : t("home.stats.caNotSetup")}
              onClick={() => navigate("/settings?tab=certificates")}
            />
            {upstreamEnabled && (
              <StatusPill
                label={t("home.stats.upstream")}
                value={`${upstreamHost}:${upstreamPort}`}
                onClick={() => navigate("/settings?tab=proxy")}
              />
            )}
            {corsOverrideEnabled && (
              <StatusPill
                label="CORS"
                value={t("home.stats.enabled")}
                onClick={() => navigate("/settings?tab=proxy")}
              />
            )}
          </div>

          <div className="border-t border-border/70 pt-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {t("home.trafficSnapshot")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("home.snapshotWindow", { seconds: LIVE_WINDOW_SECONDS })}
              </p>
            </div>

            <button
              onClick={() => navigate("/sessions")}
              className="mt-4 block w-full text-left transition-opacity hover:opacity-95"
            >
              {shouldShowTrafficTrend ? (
                <div data-testid="traffic-snapshot-trend" className="h-36 w-full min-w-0">
                  <ResponsiveContainer width="100%" height={LIVE_CHART_HEIGHT}>
                    <ComposedChart
                      data={trafficBuckets}
                      margin={LIVE_CHART_MARGIN}
                    >
                      <defs>
                        <linearGradient id="trafficSnapshotFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.14} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.22)" />
                      <XAxis dataKey="label" hide />
                      <YAxis
                        allowDecimals={false}
                        hide
                        domain={snapshotYAxisDomain}
                      />
                      <Area
                        dataKey="count"
                        type={LIVE_CHART_CURVE_TYPE}
                        fill="url(#trafficSnapshotFill)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="count"
                        type={LIVE_CHART_CURVE_TYPE}
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.25}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        dot={false}
                        activeDot={{ r: 3, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex min-h-16 items-center justify-center rounded-[var(--radius-md)] bg-muted/35 px-4 py-5 text-center text-sm text-muted-foreground">
                  {t("home.snapshotEmpty")}
                </div>
              )}
            </button>

            <div className="mt-3 grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border/60">
              <SnapshotMetric
                label={t("home.stats.sessions")}
                value={String(sessionCount)}
                onClick={() => navigate("/sessions")}
              />
              <SnapshotMetric
                label={t("sidebar.breakpoints")}
                value={pendingCount > 0 ? t("home.stats.pending", { count: pendingCount }) : t("home.stats.off")}
                onClick={() => navigate("/breakpoints")}
              />
              <SnapshotMetric
                label={t("sidebar.proxyStatus")}
                value={t(`sidebar.status.${status}`)}
                onClick={() => navigate("/settings?tab=proxy")}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ icon, label, value, onClick }: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/65 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/25 hover:text-foreground"
    >
      {icon && <span className="text-primary">{icon}</span>}
      <span className="font-medium">{label}</span>
      <span className="text-primary">{value}</span>
    </button>
  );
}

function SnapshotMetric({ label, value, onClick }: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-0 py-1 text-left transition-colors hover:text-foreground sm:px-3 sm:first:pl-0 sm:last:pr-0"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{value}</p>
    </button>
  );
}
