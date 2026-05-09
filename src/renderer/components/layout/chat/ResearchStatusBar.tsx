import { useCallback, useEffect, useRef, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import {
  decodeResearchCompletePayload,
  decodeResearchStatusUpdatePayload,
} from "../../../../shared/ipc-guards";
import { IconChevR } from "../../shared/Icons";

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
          message: "Research started…",
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
    return <div style={{ minHeight: 40 }} />;
  }

  const isErr = !!state.error;
  const isDone = !!state.doneMessage && !state.error;

  return (
    <div
      data-testid="research-status-bar"
      style={{
        margin: "12px 24px 0",
        borderRadius: 10,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: isErr ? "var(--danger-soft)" : isDone ? "var(--success-soft)" : "var(--accent-soft)",
        border: `1px solid ${isErr ? "oklch(0.82 0.07 25)" : isDone ? "oklch(0.82 0.05 145)" : "var(--accent-line)"}`,
      }}
    >
      <span className={`dot ${isErr ? "dot--danger" : isDone ? "dot--success" : "dot--accent"} ${state.active ? "dot--pulse" : ""}`} />
      <span style={{
        fontSize: 12,
        fontWeight: 500,
        color: isErr ? "oklch(0.42 0.12 25)" : isDone ? "oklch(0.38 0.09 145)" : "oklch(0.42 0.12 45)",
      }}>
        {state.active ? "Researching in background" : isErr ? "Research failed" : "Research complete"}
      </span>
      <span style={{
        fontSize: 12,
        color: "var(--ink-2)",
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {state.doneMessage ?? state.message}
      </span>
      {state.active && (
        <>
          <span className="chip chip--mono">subagents</span>
          <button type="button" className="btn btn--ghost btn--sm">Cancel</button>
        </>
      )}
      {isErr && (
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={handleRetry}
          data-testid="retry-research-btn"
        >
          Retry
        </button>
      )}
      {isDone && (
        <button type="button" className="btn btn--ghost btn--sm">
          View artifact <IconChevR size={11} />
        </button>
      )}
    </div>
  );
}
