import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "./views/Layout";
import { HomePage } from "./views/HomePage";
import { SessionsPage } from "./views/sessions/SessionsPage";
import { BreakpointsPage } from "./views/breakpoints/BreakpointsPage";
import { ScriptsPage } from "./views/scripts/ScriptsPage";
import { AIWorkspacePage } from "./views/ai/AIWorkspacePage";
import { SettingsPage } from "./views/settings/SettingsPage";
import { useSettingsStore } from "./stores/settings-store";
import { resolveThemePreference } from "./lib/theme";

export function App() {
  const themePreference = useSettingsStore((s) => s.settings.theme);
  const toasterTheme = resolveThemePreference(themePreference);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="breakpoints" element={<BreakpointsPage />} />
          <Route path="scripts" element={<ScriptsPage />} />
          <Route path="ai" element={<AIWorkspacePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster position="top-right" theme={toasterTheme} richColors closeButton />
    </BrowserRouter>
  );
}
