import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { IPC } from "../../shared/ipc-channels";
import { ipc } from "../lib/ipc-client";

export type StreamSegment =
  | { type: "text"; content: string }
  | {
      type: "activity";
      toolCallId: string;
      toolName: string;
      description: string;
      status: "running" | "done" | "error";
    };

export interface ProjectStreamState {
  streamingSegments: StreamSegment[];
  processing: boolean;
  researchCount: number;
}

// ─── Reducer state ────────────────────────────────────────────────────────────

export interface StreamState {
  states: Record<string, ProjectStreamState>;
}

// ─── Reducer actions ──────────────────────────────────────────────────────────

export type StreamAction =
  | { type: "START_STREAM"; projectId: string }
  | { type: "END_STREAM"; projectId: string }
  | { type: "APPEND_CHUNK"; projectId: string; delta: string }
  | {
      type: "TOOL_CALL_START";
      projectId: string;
      toolCallId: string;
      toolName: string;
      description: string;
    }
  | {
      type: "TOOL_CALL_END";
      projectId: string;
      toolCallId: string;
      isError: boolean;
    }
  | { type: "RESEARCH_STARTED"; projectId: string }
  | { type: "RESEARCH_ENDED"; projectId: string };

// ─── Initial state ────────────────────────────────────────────────────────────

export const initialStreamState: StreamState = { states: {} };

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "START_STREAM": {
      const existing = state.states[action.projectId];
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: {
            streamingSegments: existing?.streamingSegments ?? [],
            processing: true,
            researchCount: existing?.researchCount ?? 0,
          },
        },
      };
    }

    case "END_STREAM": {
      const existing = state.states[action.projectId];
      if (!existing) return state;
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: { ...existing, streamingSegments: [], processing: false },
        },
      };
    }

    case "RESEARCH_STARTED": {
      const existing = state.states[action.projectId];
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: {
            streamingSegments: existing?.streamingSegments ?? [],
            processing: existing?.processing ?? false,
            researchCount: (existing?.researchCount ?? 0) + 1,
          },
        },
      };
    }

    case "RESEARCH_ENDED": {
      const existing = state.states[action.projectId];
      if (!existing) return state;
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: {
            ...existing,
            researchCount: Math.max(0, existing.researchCount - 1),
          },
        },
      };
    }

    case "APPEND_CHUNK": {
      const existing = state.states[action.projectId];
      const segments: StreamSegment[] = existing?.streamingSegments
        ? [...existing.streamingSegments]
        : [];
      const last = segments[segments.length - 1];
      if (last?.type === "text") {
        segments[segments.length - 1] = {
          type: "text",
          content: last.content + action.delta,
        };
      } else {
        segments.push({ type: "text", content: action.delta });
      }
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: {
            streamingSegments: segments,
            processing: true,
            researchCount: existing?.researchCount ?? 0,
          },
        },
      };
    }

    case "TOOL_CALL_START": {
      const existing = state.states[action.projectId];
      const segments: StreamSegment[] = existing?.streamingSegments
        ? [...existing.streamingSegments]
        : [];
      segments.push({
        type: "activity",
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        description: action.description,
        status: "running",
      });
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: {
            streamingSegments: segments,
            processing: existing?.processing ?? true,
            researchCount: existing?.researchCount ?? 0,
          },
        },
      };
    }

    case "TOOL_CALL_END": {
      const existing = state.states[action.projectId];
      if (!existing) return state;
      const segments: StreamSegment[] = existing.streamingSegments.map((seg) =>
        seg.type === "activity" && seg.toolCallId === action.toolCallId
          ? { ...seg, status: action.isError ? ("error" as const) : ("done" as const) }
          : seg,
      );
      return {
        ...state,
        states: {
          ...state.states,
          [action.projectId]: { ...existing, streamingSegments: segments },
        },
      };
    }
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface StreamStateContextValue {
  states: Record<string, ProjectStreamState>;
  startStream(projectId: string): void;
  endStream(projectId: string): void;
}

const StreamStateContext = createContext<StreamStateContextValue>({
  states: {},
  startStream: () => {},
  endStream: () => {},
});

export { StreamStateContext };

export function StreamStateProvider({ children }: { children: ReactNode }) {
  const [{ states }, dispatch] = useReducer(streamReducer, initialStreamState);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const STREAM_TIMEOUT_MS = 300_000;

  const clearTimer = useCallback((projectId: string) => {
    const timer = timersRef.current[projectId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[projectId];
    }
  }, []);

  const startTimer = useCallback(
    (projectId: string) => {
      clearTimer(projectId);
      timersRef.current[projectId] = setTimeout(() => {
        dispatch({ type: "END_STREAM", projectId });
      }, STREAM_TIMEOUT_MS);
    },
    [clearTimer],
  );

  const startStream = useCallback(
    (projectId: string) => {
      dispatch({ type: "START_STREAM", projectId });
      startTimer(projectId);
    },
    [startTimer],
  );

  const endStream = useCallback(
    (projectId: string) => {
      clearTimer(projectId);
      dispatch({ type: "END_STREAM", projectId });
    },
    [clearTimer],
  );

  useEffect(() => {
    const unsubChunk = ipc.on(IPC.MESSAGE_CHUNK, (event) => {
      const { projectId, delta } = event;
      if (!projectId) return;
      dispatch({ type: "APPEND_CHUNK", projectId, delta });
      startTimer(projectId);
    });

    const unsubDone = ipc.on(IPC.MESSAGE_DONE, (event) => {
      const { projectId } = event;
      if (!projectId) return;
      endStream(projectId);
    });

    const unsubProgress = ipc.on(IPC.AGENT_PROGRESS, (event) => {
      const { kind } = event.event;

      if (kind === "tool_call_start") {
        const { projectId, toolCallId, toolName, description } = event.event;
        dispatch({ type: "TOOL_CALL_START", projectId, toolCallId, toolName, description });
      } else if (kind === "tool_call_end") {
        const { projectId, toolCallId, isError } = event.event;
        dispatch({ type: "TOOL_CALL_END", projectId, toolCallId, isError });
      } else if (kind === "research_started") {
        dispatch({ type: "RESEARCH_STARTED", projectId: event.event.projectId });
      } else if (kind === "research_complete" || kind === "research_failed") {
        dispatch({ type: "RESEARCH_ENDED", projectId: event.event.projectId });
      }
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubProgress();
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
      timersRef.current = {};
    };
  }, [endStream, startTimer]);

  return (
    <StreamStateContext.Provider value={{ states, startStream, endStream }}>
      {children}
    </StreamStateContext.Provider>
  );
}

export function useStreamState(): StreamStateContextValue {
  return useContext(StreamStateContext);
}
