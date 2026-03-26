import { create } from "zustand";
import { toast } from "sonner";
import i18n from "@/i18n";

export interface SkillSummary {
  name: string;
  version: string;
  description: string;
  toolCount: number;
}

interface SkillState {
  skills: SkillSummary[];
  isLoading: boolean;

  loadSkills: () => Promise<void>;
  installSkill: (sourcePath: string) => Promise<void>;
  uninstallSkill: (name: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set) => ({
  skills: [],
  isLoading: false,

  loadSkills: async () => {
    try {
      set({ isLoading: true });
      const { invoke } = await import("@tauri-apps/api/core");
      const skills = await invoke<SkillSummary[]>("ai_list_skills");
      set({ skills, isLoading: false });
    } catch {
      toast.error(i18n.t("ai.error.loadSkillsFailed"));
      set({ isLoading: false });
    }
  },

  installSkill: async (sourcePath: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const skill = await invoke<SkillSummary>("ai_install_skill", {
        sourcePath,
      });
      set((state) => ({
        skills: [...state.skills.filter((s) => s.name !== skill.name), skill],
      }));
    } catch (e) {
      throw e;
    }
  },

  uninstallSkill: async (name: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ai_uninstall_skill", { skillName: name });
      set((state) => ({
        skills: state.skills.filter((s) => s.name !== name),
      }));
    } catch (e) {
      throw e;
    }
  },
}));
