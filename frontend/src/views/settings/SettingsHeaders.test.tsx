import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SkillManagerPanel } from "../ai/SkillManagerPanel";
import { useSkillStore } from "@/stores/skill-store";

beforeEach(() => {
  useSkillStore.setState({
    skills: [],
    isLoading: false,
    loadSkills: vi.fn().mockResolvedValue(undefined),
    installSkill: vi.fn().mockResolvedValue(undefined),
    uninstallSkill: vi.fn().mockResolvedValue(undefined),
  });
});

test("renders the skills settings page with the shared lightweight section header", () => {
  render(<SkillManagerPanel />);

  expect(screen.getByTestId("settings-section-header")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AI Skills" })).toBeInTheDocument();
  expect(screen.getByText("Manage installed skills available to the AI workspace.")).toBeInTheDocument();
});
