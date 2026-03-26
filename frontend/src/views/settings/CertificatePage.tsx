import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useCertStore } from "@/stores/cert-store";
import { useProxyStore } from "@/stores/proxy-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/AlertBanner";
import { SettingsSectionHeader } from "@/components/SettingsSectionHeader";

export function CertificatePage() {
  const { t } = useTranslation();
  const { hasCA, isInstalled, isGenerating, isInstalling, error, checkStatus, generateCA, installCA, showInFinder } = useCertStore();
  const proxyStatus = useProxyStore((state) => state.status);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const httpsReady = hasCA && isInstalled;
  const isProxyRunning = proxyStatus === "running" || proxyStatus === "starting";
  const runtimeNotice = httpsReady
    ? isProxyRunning
      ? t("cert.notice.readyRunning")
      : t("cert.notice.readyStopped")
    : t("cert.notice.notReady");
  const runtimeVariant = httpsReady ? "info" : "warning";
  const showRuntimeNotice = !httpsReady || isProxyRunning;

  return (
    <div className="mx-auto max-w-4xl px-4 py-5">
      <SettingsSectionHeader
        title={t("cert.title")}
        description={t("cert.description")}
        aside={(
          <Badge variant={httpsReady ? "default" : "outline"}>
            {httpsReady ? t("cert.status.ready") : t("cert.status.notReady")}
          </Badge>
        )}
      />

      <section className="rounded-[var(--radius-xl)] border border-border bg-card p-5 shadow-[var(--panel-shadow)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("cert.configuration.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("cert.configuration.description")}</p>
          </div>
          <Badge variant={httpsReady ? "cert" : "outline"}>
            {httpsReady ? t("cert.status.ready") : t("cert.status.notReady")}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("cert.configuration.statusLabel")}</span>
          <Badge variant={hasCA ? "default" : "outline"}>
            {hasCA ? t("cert.status.generated") : t("cert.status.missing")}
          </Badge>
          <Badge variant={isInstalled ? "default" : "outline"}>
            {isInstalled ? t("cert.status.trusted") : t("cert.status.notTrusted")}
          </Badge>
        </div>

        <div className="mt-5 space-y-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t("cert.cards.authorityTitle")}</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {hasCA ? t("cert.caReady") : t("cert.cards.authorityPending")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
              <Badge variant={hasCA ? "default" : "outline"}>
                {hasCA ? t("cert.status.generated") : t("cert.status.missing")}
              </Badge>
              <Button
                onClick={generateCA}
                disabled={isGenerating}
                size="sm"
              >
                {isGenerating && <Loader2 size={12} className="animate-spin" />}
                {hasCA ? t("cert.regenerate") : t("cert.generate")}
              </Button>
              {hasCA && (
                <Button
                  onClick={showInFinder}
                  variant="outline"
                  size="sm"
                >
                  {t("cert.showInFinder")}
                </Button>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t("cert.cards.trustTitle")}</p>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  {hasCA ? t("cert.trustHint") : t("cert.cards.trustPending")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                <Badge variant={isInstalled ? "default" : "outline"}>
                  {isInstalled ? t("cert.status.trusted") : t("cert.status.notTrusted")}
                </Badge>
                {hasCA && (
                  <Button
                    onClick={installCA}
                    disabled={isInstalling}
                    size="sm"
                  >
                    {isInstalling && <Loader2 size={12} className="animate-spin" />}
                    {t("cert.installAndTrust")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {showRuntimeNotice && (
            <div className="border-t border-border pt-5">
              <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
                <AlertBanner variant={runtimeVariant} className="rounded-[var(--radius-lg)] border px-3 py-3 text-xs">
                  {runtimeNotice}
                </AlertBanner>
              </div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="mt-4">
          <AlertBanner variant="error" className="rounded-md border">
            {error}
          </AlertBanner>
        </div>
      )}
    </div>
  );
}
