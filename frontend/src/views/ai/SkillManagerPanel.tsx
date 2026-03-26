import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Package, Trash2, FolderOpen } from "lucide-react";
import { useSkillStore } from "@/stores/skill-store";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { SettingsSectionHeader } from "@/components/SettingsSectionHeader";

export function SkillManagerPanel() {
  const { t } = useTranslation();
  const { skills, loadSkills, uninstallSkill } = useSkillStore();

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleInstall = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        title: t("ai.skill.installFrom"),
      });
      if (!selected) return;
      const sourcePath = typeof selected === "string" ? selected : selected[0];
      if (!sourcePath) return;
      await useSkillStore.getState().installSkill(sourcePath);
      toast.success(t("ai.skill.installed"));
    } catch {
      toast.error(t("ai.error.installSkillFailed"));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-5">
        <SettingsSectionHeader
          title={t("settings.skills.title")}
          description={t("settings.skills.description")}
        />

        <Button
          onClick={handleInstall}
          variant="outline"
          size="sm"
          className="gap-1"
        >
          <FolderOpen size={12} />
          {t("ai.skill.install")}
        </Button>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pb-5">
        {skills.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title={t("ai.skill.noSkills")}
            subtitle={t("ai.skill.noSkillsHint")}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {skills.map((skill) => (
              <div
                key={skill.name}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <Package size={14} className="shrink-0 text-ai" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground truncate">
                      {skill.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      v{skill.version}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {skill.description}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {t("ai.skill.tools", { count: skill.toolCount })}
                  </span>
                </div>
                <Button
                  onClick={() => uninstallSkill(skill.name)}
                  variant="ghost"
                  size="icon-sm"
                  title={t("ai.skill.uninstall")}
                  className="hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
