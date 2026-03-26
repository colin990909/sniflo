import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2 } from "lucide-react";
import { Section, FormField } from "@/components/FormSection";
import { useSettingsStore } from "@/stores/settings-store";
import { useUpdateStore } from "@/stores/update-store";
import { applyLanguagePreference } from "@/i18n";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PillSelect } from "@/components/PillSelect";
import { AlertBanner } from "@/components/AlertBanner";
import { SettingsSectionHeader } from "@/components/SettingsSectionHeader";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { applyThemePreference } from "@/lib/theme";

export function GeneralSettings() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsStore();
  const {
    currentVersion, latestRelease, hasUpdate, checking, error,
    initialize, checkForUpdate,
  } = useUpdateStore();

  // Ensure version is loaded when settings page opens
  useEffect(() => {
    if (!currentVersion) initialize();
  }, [currentVersion, initialize]);

  const handleLanguageChange = (lang: string) => {
    update({ language: lang });
    applyLanguagePreference(lang);
  };

  const handleThemeChange = (theme: "light" | "dark") => {
    update({ theme });
    applyThemePreference(theme);
  };

  const handleViewRelease = () => {
    if (!latestRelease) return;
    import("@tauri-apps/plugin-shell").then(({ open }) => {
      open(latestRelease.htmlUrl);
    }).catch(() => {
      window.open(latestRelease.htmlUrl, "_blank");
    });
  };

  const languageOptions = [
    { value: "system", label: t("settings.language.system") },
    { value: "en", label: t("settings.language.english") },
    { value: "zh-Hans", label: t("settings.language.zhHans") },
  ];
  const themeOptions: Array<{ value: "light" | "dark"; label: string }> = [
    { value: "light", label: t("settings.theme.light") },
    { value: "dark", label: t("settings.theme.dark") },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-5">
      <SettingsSectionHeader
        title={t("settings.general.title")}
        description={t("settings.general.description")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("settings.language.label")}>
          <PillSelect
            options={languageOptions}
            value={settings.language}
            onChange={handleLanguageChange}
          />
        </Section>

        <Section title={t("settings.theme.label")}>
          <PillSelect
            options={themeOptions}
            value={settings.theme}
            onChange={handleThemeChange}
          />
        </Section>

        <Section title={t("settings.autoStartProxy.label")}>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.autoStartProxy.description")}</p>
            <Switch
              checked={settings.autoStartProxy}
              onCheckedChange={(checked) => update({ autoStartProxy: checked })}
            />
          </div>
        </Section>

        <Section title={t("settings.maxSessions.label")}>
          <FormField label={t("settings.maxSessions.description")}>
            <Input
              type="number"
              min={0}
              value={settings.maxSessions}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 0) update({ maxSessions: val });
              }}
              className="w-40"
            />
          </FormField>
        </Section>
      </div>

      <div className="mt-4">
      <Section title={t("update.about")}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("update.currentVersion")}</span>
            <Badge variant="outline">{currentVersion || "…"}</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkForUpdate(false)}
              disabled={checking}
              className="gap-1.5"
            >
              {checking && <Loader2 size={12} className="animate-spin" />}
              {checking ? t("update.checking") : t("update.checkForUpdates")}
            </Button>

            {hasUpdate && latestRelease && (
              <div className="flex items-center gap-2">
                <Badge className="border-transparent bg-green-500/15 text-green-400">
                  {latestRelease.tagName}
                </Badge>
                <button
                  className="flex items-center gap-1 text-sm text-primary hover:underline"
                  onClick={handleViewRelease}
                >
                  {t("update.viewRelease")}
                  <ExternalLink size={10} />
                </button>
              </div>
            )}

            {!hasUpdate && !checking && latestRelease && (
              <span className="text-xs text-muted-foreground">{t("update.upToDate")}</span>
            )}
          </div>

          {error && (
            <AlertBanner variant="error">
              {t("update.checkFailed")}: {error}
            </AlertBanner>
          )}

          {hasUpdate && latestRelease?.body && (
            <div className="rounded-[var(--radius-lg)] border border-border bg-muted/30 p-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                {t("update.releaseNotes")}
              </p>
              <div className="max-h-40 overflow-y-auto text-sm leading-relaxed text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {latestRelease.body}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </Section>
      </div>
    </div>
  );
}
