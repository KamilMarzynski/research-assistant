import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import {
  decodeResearchCompletePayload,
  decodeResearchStatusUpdatePayload,
} from "../../../../shared/ipc-guards";
import { glassSx } from "../../../styles/glass";

interface ResearchState {
  active: boolean;
  message: string;
  doneMessage: string | null;
  error: string | null;
  failedTaskId: string | null;
  failedProjectId: string | null;
  failedQuery: string | null;
}

const DISMISS_TIMEOUT_MS = 30_000;

export default function ResearchStatusBar() {
  const [state, setState] = useState<ResearchState>({
    active: false,
    message: "",
    doneMessage: null,
    error: null,
    failedTaskId: null,
    failedProjectId: null,
    failedQuery: null,
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const handleRetry = useCallback(() => {
    if (!state.failedProjectId || !state.failedQuery) return;
    clearTimers();
    setState({
      active: false,
      message: "",
      doneMessage: null,
      error: null,
      failedTaskId: null,
      failedProjectId: null,
      failedQuery: null,
    });
    window.electronAPI.invoke(IPC.RETRY_RESEARCH, {
      projectId: state.failedProjectId,
      query: state.failedQuery,
    });
  }, [state.failedProjectId, state.failedQuery, clearTimers]);

  useEffect(() => {
    const unsubUpdate = window.electronAPI.on(IPC.RESEARCH_STATUS_UPDATE, (data) => {
      const d = decodeResearchStatusUpdatePayload(data);
      if (!d) return;
      if (d.status === "started") {
        clearTimers();
        setState({
          active: true,
          message: "Research started\u2026",
          doneMessage: null,
          error: null,
          failedTaskId: null,
          failedProjectId: null,
          failedQuery: null,
        });
      } else if (d.status === "progress" && d.message) {
        const display = d.label ? `${d.label} ${d.message}` : d.message;
        setState((prev) => ({ ...prev, message: display ?? prev.message }));
      } else if (d.status === "failed") {
        const errorText = d.error ?? "Research failed.";
        clearTimers();
        setState({
          active: false,
          message: "",
          doneMessage: errorText,
          error: errorText,
          failedTaskId: d.taskId ?? null,
          failedProjectId: d.projectId ?? null,
          failedQuery: d.query ?? null,
        });
        timers.current.push(
          setTimeout(() => {
            setState((s) => ({
              ...s,
              doneMessage: null,
              error: null,
              failedTaskId: null,
              failedProjectId: null,
              failedQuery: null,
            }));
          }, DISMISS_TIMEOUT_MS),
        );
      }
    });

    const unsubComplete = window.electronAPI.on(IPC.RESEARCH_COMPLETE, (data) => {
      const d = decodeResearchCompletePayload(data);
      if (!d) return;
      clearTimers();
      setState({
        active: false,
        message: "",
        doneMessage: `Done: ${d.query}`,
        error: null,
        failedTaskId: null,
        failedProjectId: null,
        failedQuery: null,
      });
      timers.current.push(
        setTimeout(() => {
          setState((s) => ({ ...s, doneMessage: null }));
        }, DISMISS_TIMEOUT_MS),
      );
    });

    return () => {
      unsubUpdate();
      unsubComplete();
      clearTimers();
    };
  }, [clearTimers]);

  if (!state.active && !state.doneMessage && !state.error) {
    return <Box sx={{ minHeight: 40 }} />;
  }

  return (
    <Box
      data-testid="research-status-bar"
      sx={{
        ...glassSx,
        px: 2,
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 1,
        minHeight: 40,
      }}
    >
      {state.active && <CircularProgress size={14} />}
      <Typography
        variant="caption"
        color={state.error ? "error" : "text.secondary"}
        sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {state.doneMessage ?? state.message}
      </Typography>
      {state.error && (
        <Button
          size="small"
          variant="outlined"
          color="primary"
          onClick={handleRetry}
          data-testid="retry-research-btn"
          sx={{ minWidth: 60, flexShrink: 0 }}
        >
          Retry
        </Button>
      )}
    </Box>
  );
}
