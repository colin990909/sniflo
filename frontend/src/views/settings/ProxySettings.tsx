import { useTranslation } from "react-i18next";
import { Section, FormField } from "@/components/FormSection";
import { useProxyStore } from "@/stores/proxy-store";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { AlertBanner } from "@/components/AlertBanner";
import { SettingsSectionHeader } from "@/components/SettingsSectionHeader";

export function ProxySettings() {
  const { t } = useTranslation();
  const {
    status, listenHost, listenPort,
    upstreamEnabled, upstreamHost, upstreamPort, corsOverrideEnabled,
  } = useProxyStore();

  const isLocked = status === "running" || status === "starting";

  return (
    <div className="mx-auto max-w-xl px-4 py-5">
      <SettingsSectionHeader
        title={t("settings.proxy.title")}
        description={t("settings.proxy.description")}
      />

      {isLocked && (
        <div className="mb-4">
          <AlertBanner variant="warning" className="rounded-lg border">
            {t("settings.proxy.runningWarning")}
          </AlertBanner>
        </div>
      )}

      <div className="stack-base">
        <Section title={t("capture.title")}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("capture.listenHost")}>
              <Input
                value={listenHost}
                onChange={(e) => useProxyStore.getState().setListenHost(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
            <FormField label={t("capture.listenPort")}>
              <Input
                value={listenPort}
                onChange={(e) => useProxyStore.getState().setListenPort(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
          </div>
        </Section>

        <Section title={t("capture.upstream.title")}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">{t("capture.upstream.enabled")}</span>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("capture.upstream.description")}</p>
            </div>
            <Switch
              checked={upstreamEnabled}
              onCheckedChange={(checked) => useProxyStore.getState().setUpstreamEnabled(checked)}
              disabled={isLocked}
            />
          </div>
          {upstreamEnabled && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <FormField label={t("capture.upstream.host")}>
                <Input
                  value={upstreamHost}
                  onChange={(e) => useProxyStore.getState().setUpstreamHost(e.target.value)}
                  disabled={isLocked}
                />
              </FormField>
              <FormField label={t("capture.upstream.port")}>
                <Input
                  value={upstreamPort}
                  onChange={(e) => useProxyStore.getState().setUpstreamPort(e.target.value)}
                  disabled={isLocked}
                />
              </FormField>
            </div>
          )}
        </Section>

        <Section title={t("cors.override")}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{t("cors.overrideDescription")}</p>
            <Switch
              checked={corsOverrideEnabled}
              onCheckedChange={(checked) => useProxyStore.getState().setCorsOverrideEnabled(checked)}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
