import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Sidebar } from "./Sidebar";
import { useSettingsStore } from "@/stores/settings-store";
import { useProxyStore } from "@/stores/proxy-store";
import { useCertStore } from "@/stores/cert-store";
import { useBreakpointStore } from "@/stores/breakpoint-store";
import { useScriptStore } from "@/stores/script-store";
import { useAIStore } from "@/stores/ai-store";
import { useUpdateStore } from "@/stores/update-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { applyLanguagePreference } from "@/i18n";
import { useTauriEvents } from "@/hooks/use-tauri-events";
import { applyThemePreference } from "@/lib/theme";

export function Layout() {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.settings.theme);

  // Register all Tauri backend event listeners
  useTauriEvents();

  useEffect(() => {
    applyThemePreference(theme);
  }, [theme]);

  // Load persisted data on app startup
  useEffect(() => {
    useSettingsStore.getState().load().then(() => {
      const { settings } = useSettingsStore.getState();
      useProxyStore.getState().hydrateFromSettings(settings);
      applyLanguagePreference(settings.language);
      applyThemePreference(settings.theme);

      if (settings.autoStartProxy) {
        useProxyStore.getState().startProxy();
      }
    });
    useRuntimeStore.getState().load();
    useCertStore.getState().checkStatus();
    useBreakpointStore.getState().loadFromBackend();
    useScriptStore.getState().load();
    useAIStore.getState().loadConversations();

    // Silent update check on startup
    const updateStore = useUpdateStore.getState();
    updateStore.initialize().then(() => {
      updateStore.checkForUpdate(true).then(() => {
        const { hasUpdate, latestRelease } = useUpdateStore.getState();
        if (hasUpdate && latestRelease) {
          toast.info(t("update.available", { version: latestRelease.tagName }), {
            description: t("update.clickToView"),
            duration: 8000,
            action: {
              label: t("update.viewRelease"),
              onClick: () => {
                import("@tauri-apps/plugin-shell").then(({ open }) => {
                  open(latestRelease.htmlUrl);
                }).catch(() => {
                  window.open(latestRelease.htmlUrl, "_blank");
                });
              },
            },
          });
        }
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden content-ambient">
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
