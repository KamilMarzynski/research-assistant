import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/700.css";
import { Alert, CssBaseline, Snackbar, ThemeProvider } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../shared/ipc-channels";
import AppShell from "./components/layout/AppShell";
import SettingsModal from "./components/settings/SettingsModal";
import { ProjectProvider } from "./contexts/ProjectContext";
import { createAppTheme } from "./theme";

const theme = createAppTheme();

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fallbackAlert, setFallbackAlert] = useState<string | null>(null);

  useEffect(() => {
    const remove = window.electronAPI.on(IPC.MODEL_FALLBACK, (payload: unknown) => {
      const p = payload as { reason: string; fallbackProvider: string };
      if (p.reason === "ollama_unavailable") {
        setFallbackAlert(`Ollama is offline. Switched to ${p.fallbackProvider}.`);
      }
    });
    return remove;
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ProjectProvider>
        <AppShell onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ProjectProvider>
      <Snackbar
        open={!!fallbackAlert}
        autoHideDuration={6000}
        onClose={() => setFallbackAlert(null)}
      >
        <Alert severity="warning" onClose={() => setFallbackAlert(null)}>
          {fallbackAlert}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}
