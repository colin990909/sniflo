import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Settings, Radio, Plug, ShieldCheck,
} from "lucide-react";
import { GeneralSettings } from "./GeneralSettings";
import { ProxySettings } from "./ProxySettings";
import { AIRuntimeSettingsPage } from "./AIRuntimeSettingsPage";
import { CertificatePage } from "./CertificatePage";
import { PageToolbar } from "@/components/PageToolbar";

interface SettingsTab {
  id: string;
  icon: React.ReactNode;
  labelKey: string;
}

const TABS: SettingsTab[] = [
  { id: "general", icon: <Settings size={16} />, labelKey: "settings.tabs.general" },
  { id: "proxy", icon: <Radio size={16} />, labelKey: "settings.tabs.proxy" },
  { id: "runtimes", icon: <Plug size={16} />, labelKey: "settings.tabs.runtimes" },
  { id: "certificates", icon: <ShieldCheck size={16} />, labelKey: "settings.tabs.certificates" },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get("tab");
  const normalizedTab = activeTabParam === "providers" ? "runtimes" : activeTabParam ?? "general";
  const activeTab = TABS.some((tab) => tab.id === normalizedTab) ? normalizedTab : "general";

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId }, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <PageToolbar>
        <div className="workspace-icon">
          <Settings size={18} />
        </div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">{t("settings.title")}</h1>
      </PageToolbar>

      <div className="flex flex-1 min-h-0">
        <div
          data-testid="settings-shell-left-rail"
          className="flex w-[248px] flex-col border-r border-border bg-sidebar/80"
        >
          <nav className="flex-1 overflow-y-auto p-3">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-[var(--radius-xl)] px-3 py-2.5 text-left text-[13px] transition-all duration-150 ${
                  activeTab === tab.id
                    ? "bg-card font-medium text-foreground shadow-[var(--panel-shadow)]"
                    : "text-sidebar-foreground/65 hover:bg-card/70 hover:text-sidebar-foreground/95"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-lg)] ${
                    activeTab === tab.id ? "bg-primary/12 text-primary" : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {tab.icon}
                </span>
                <span>{t(tab.labelKey)}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="content-ambient flex-1 overflow-y-auto">
          {activeTab === "general" && <GeneralSettings />}
          {activeTab === "proxy" && <ProxySettings />}
          {activeTab === "runtimes" && <AIRuntimeSettingsPage />}
          {activeTab === "certificates" && <CertificatePage />}
        </div>
      </div>
    </div>
  );
}
