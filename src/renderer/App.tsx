import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import { useState } from "react";
import AppShell from "./components/layout/AppShell";
import SettingsModal from "./components/settings/SettingsModal";
import { ProjectProvider } from "./contexts/ProjectContext";
import { createAppTheme } from "./theme";

export default function App() {
  const isDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = createAppTheme(isDark ? "dark" : "light");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ProjectProvider>
        <AppShell onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ProjectProvider>
    </ThemeProvider>
  );
}
