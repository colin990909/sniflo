import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Home,
  Network,
  Pause,
  FileCode,
  Sparkles,
  Settings,
  Moon,
  SunMedium,
} from "lucide-react";
import { useProxyStore } from "@/stores/proxy-store";
import { useAppStore } from "@/stores/app-store";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { useSettingsStore } from "@/stores/settings-store";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/AppLogo";
import { applyThemePreference } from "@/lib/theme";

interface NavItem {
  to: string;
  icon: React.ReactNode;
  labelKey: string;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { to: "/", icon: <Home size={16} />, labelKey: "sidebar.home" },
  { to: "/sessions", icon: <Network size={16} />, labelKey: "sidebar.sessions" },
  { to: "/breakpoints", icon: <Pause size={16} />, labelKey: "sidebar.breakpoints" },
  { to: "/scripts", icon: <FileCode size={16} />, labelKey: "sidebar.scripts" },
  { to: "/ai", icon: <Sparkles size={16} />, labelKey: "sidebar.ai" },
];

const CONFIG_ITEMS: NavItem[] = [
  { to: "/settings", icon: <Settings size={16} />, labelKey: "sidebar.settings" },
];

export function Sidebar() {
  const { t } = useTranslation();
  const { status: proxyStatus } = useProxyStore();
  const sessionCount = useAppStore((s) => s.sessions.length);
  const pendingCount = useBreakpointStore((s) => s.pendingCount);
  const theme = useSettingsStore((s) => s.settings.theme);
  const updateSettings = useSettingsStore((s) => s.update);

  const cycleTheme = () => {
    const order: Array<"light" | "dark"> = ["light", "dark"];
    const currentIndex = order.indexOf(theme);
    const nextTheme = order[(currentIndex + 1) % order.length];
    updateSettings({ theme: nextTheme });
    applyThemePreference(nextTheme);
  };

  const themeIcon = theme === "dark"
    ? <Moon size={15} />
    : <SunMedium size={15} />;
  const proxyStatusLabel = proxyStatus === "running"
    ? t("sidebar.status.running")
    : proxyStatus === "starting"
      ? t("sidebar.status.starting")
      : proxyStatus === "failed"
        ? t("sidebar.status.failed")
        : t("sidebar.status.stopped");

  return (
    <aside className="sidebar-surface flex w-[264px] flex-col text-sidebar-foreground">
      <div data-tauri-drag-region className="h-[30px] shrink-0" />

      <div className="px-3 pb-3">
        <div className="flex items-center gap-3 px-3 py-3">
          <AppLogo size={26} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p
              aria-label="Sniflo"
              className="truncate text-[15px] font-medium uppercase tracking-[0.24em] text-foreground/95"
            >
              <span className="text-primary">S</span>niflo
            </p>
            <span
              aria-hidden="true"
              className="mt-1 block h-px w-16 rounded-full bg-gradient-to-r from-primary/55 via-primary/20 to-transparent"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={cycleTheme}
            aria-label={t("settings.theme.toggle")}
            title={t("settings.theme.toggle")}
            className="rounded-lg bg-card"
          >
            {themeIcon}
          </Button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-1">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("sidebar.workspace")}
        </p>
        <div className="space-y-0.5">
          {WORKSPACE_ITEMS.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              badge={
                item.to === "/sessions" && sessionCount > 0
                  ? sessionCount
                  : item.to === "/breakpoints" && pendingCount > 0
                    ? pendingCount
                    : undefined
              }
            />
          ))}
        </div>

        <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("sidebar.configuration")}
        </p>
        <div className="space-y-0.5">
          {CONFIG_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 px-3 py-2">
          <StatusDot active={proxyStatus === "running"} />
          <p className="text-xs font-medium text-muted-foreground">
            {`${t("sidebar.proxyStatus")} · ${proxyStatusLabel}`}
          </p>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ item, badge }: { item: NavItem; badge?: number }) {
  const { t } = useTranslation();

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-[var(--radius-xl)] px-3 py-2.5 text-[13px] transition-all duration-150 ${
          isActive
            ? "bg-card text-foreground font-medium shadow-[var(--panel-shadow)]"
            : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
          )}
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] ${isActive ? "bg-primary/12 text-primary" : "bg-muted/60 text-muted-foreground group-hover:text-foreground"}`}>
            {item.icon}
          </span>
          <span className="flex-1">{t(item.labelKey)}</span>
          {badge !== undefined && (
            <span className="min-w-[22px] rounded-full bg-primary/10 px-2 py-0.5 text-center text-[10px] font-semibold leading-tight text-primary">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
