import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import { useState } from "react";
import AppShell from "./components/layout/AppShell";
import SettingsView from "./components/settings/SettingsView";
import { ProjectProvider } from "./contexts/ProjectContext";
import { ThemeProvider } from "./theme/ThemeContext";

export default function App() {
  const [view, setView] = useState<"main" | "settings">("main");

  return (
    <ThemeProvider>
      <ProjectProvider>
        {view === "main" ? (
          <AppShell onOpenSettings={() => setView("settings")} />
        ) : (
          <SettingsView onBack={() => setView("main")} />
        )}
      </ProjectProvider>
    </ThemeProvider>
  );
}
