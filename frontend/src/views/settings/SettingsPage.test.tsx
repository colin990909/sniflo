import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { SettingsPage } from "./SettingsPage";
import i18n from "@/i18n";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

test("renders a shared full-width settings header with no duplicate rail title", () => {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );

  const sharedHeader = screen.getByRole("heading", { name: "Settings" }).closest(".toolbar-surface");
  expect(screen.getAllByRole("heading", { name: "Settings" })).toHaveLength(1);
  expect(sharedHeader).toBeInTheDocument();
  expect(sharedHeader).toHaveClass("px-[var(--space-5)]");

  const leftRail = screen.getByTestId("settings-shell-left-rail");
  expect(within(leftRail).queryByRole("heading", { name: "Settings" })).toBeNull();
});

test("hides the skills settings tab and shows AI configuration in Chinese", async () => {
  await i18n.changeLanguage("zh-Hans");

  render(
    <MemoryRouter initialEntries={["/settings?tab=runtimes"]}>
      <SettingsPage />
    </MemoryRouter>,
  );

  const leftRail = screen.getByTestId("settings-shell-left-rail");
  expect(within(leftRail).queryByRole("button", { name: /Skill/ })).toBeNull();
  expect(within(leftRail).getByRole("button", { name: "AI 配置" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AI 配置" })).toBeInTheDocument();
});

test("falls back to the general page when the hidden skills tab is requested", () => {
  render(
    <MemoryRouter initialEntries={["/settings?tab=skills"]}>
      <SettingsPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
});
