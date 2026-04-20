import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";

interface ResearchState {
  active: boolean;
  message: string;
  doneMessage: string | null;
}

export default function ResearchStatusBar() {
  const [state, setState] = useState<ResearchState>({
    active: false,
    message: "",
    doneMessage: null,
  });

  useEffect(() => {
    const unsubUpdate = window.electronAPI.on(IPC.RESEARCH_STATUS_UPDATE, (data) => {
      const d = data as { status: string; message?: string; query?: string };
      if (d.status === "started") {
        setState({ active: true, message: "Research started…", doneMessage: null });
      } else if (d.status === "progress" && d.message) {
        setState((prev) => ({ ...prev, message: d.message ?? prev.message }));
      } else if (d.status === "failed") {
        setState({ active: false, message: "", doneMessage: "Research failed." });
        setTimeout(() => setState((s) => ({ ...s, doneMessage: null })), 3000);
      }
    });

    const unsubComplete = window.electronAPI.on(IPC.RESEARCH_COMPLETE, (data) => {
      const d = data as { query: string };
      setState({ active: false, message: "", doneMessage: `Done: ${d.query}` });
      setTimeout(() => setState((s) => ({ ...s, doneMessage: null })), 3000);
    });

    return () => {
      unsubUpdate();
      unsubComplete();
    };
  }, []);

  if (!state.active && !state.doneMessage) {
    return <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", minHeight: 40 }} />;
  }

  return (
    <Box
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        gap: 1,
        minHeight: 40,
      }}
    >
      {state.active && <CircularProgress size={14} />}
      <Typography variant="caption" color="text.secondary" noWrap>
        {state.doneMessage ?? state.message}
      </Typography>
    </Box>
  );
}
