import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import { Alert, Snackbar } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../shared/ipc-channels";
import { decodeModelFallbackPayload } from "../shared/ipc-guards";
import AppShell from "./components/layout/AppShell";
import SettingsView from "./components/settings/SettingsView";
import { ProjectProvider } from "./contexts/ProjectContext";
import { ThemeProvider } from "./theme/ThemeContext";

export default function App() {
  const [view, setView] = useState<"main" | "settings">("main");
  const [fallbackAlert, setFallbackAlert] = useState<string | null>(null);

  useEffect(() => {
    const remove = window.electronAPI.on(IPC.MODEL_FALLBACK, (payload: unknown) => {
      const p = decodeModelFallbackPayload(payload);
      if (!p) return;
      if (p.reason === "ollama_unavailable") {
        setFallbackAlert(`Ollama is offline. Switched to ${p.fallbackProvider}.`);
      }
    });
    return remove;
  }, []);

  return (
    <ThemeProvider>
      <ProjectProvider>
        {view === "main" ? (
          <AppShell onOpenSettings={() => setView("settings")} />
        ) : (
          <SettingsView onBack={() => setView("main")} />
        )}
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
