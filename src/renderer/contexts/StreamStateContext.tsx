import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
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
}

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
  const [states, setStates] = useState<Record<string, ProjectStreamState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
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
        setStates((prev) => {
          const next = { ...prev };
          if (next[projectId]) {
            next[projectId] = { ...next[projectId], streamingSegments: [], processing: false };
          }
          return next;
        });
      }, STREAM_TIMEOUT_MS);
    },
    [clearTimer],
  );

  const startStream = useCallback(
    (projectId: string) => {
      setStates((prev) => {
        const existing = prev[projectId];
        return {
          ...prev,
          [projectId]: {
            streamingSegments: existing?.streamingSegments ?? [],
            processing: true,
          },
        };
      });
      startTimer(projectId);
    },
    [startTimer],
  );

  const endStream = useCallback(
    (projectId: string) => {
      clearTimer(projectId);
      setStates((prev) => {
        const next = { ...prev };
        if (next[projectId]) {
          next[projectId] = { ...next[projectId], streamingSegments: [], processing: false };
        }
        return next;
      });
    },
    [clearTimer],
  );

  useEffect(() => {
    const unsubChunk = ipc.on(IPC.MESSAGE_CHUNK, (event) => {
      const { projectId, delta } = event;
      if (!projectId) return;

      setStates((prev) => {
        const existing = prev[projectId];
        const segments: StreamSegment[] = existing?.streamingSegments
          ? [...existing.streamingSegments]
          : [];
        const last = segments[segments.length - 1];
        if (last?.type === "text") {
          segments[segments.length - 1] = { type: "text", content: last.content + delta };
        } else {
          segments.push({ type: "text", content: delta });
        }
        return {
          ...prev,
          [projectId]: { streamingSegments: segments, processing: true },
        };
      });
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
        setStates((prev) => {
          const existing = prev[projectId];
          const segments: StreamSegment[] = existing?.streamingSegments
            ? [...existing.streamingSegments]
            : [];
          segments.push({ type: "activity", toolCallId, toolName, description, status: "running" });
          return {
            ...prev,
            [projectId]: {
              streamingSegments: segments,
              processing: existing?.processing ?? true,
            },
          };
        });
      } else if (kind === "tool_call_end") {
        const { projectId, toolCallId, isError } = event.event;
        setStates((prev) => {
          const existing = prev[projectId];
          if (!existing) return prev;
          const segments: StreamSegment[] = existing.streamingSegments.map((seg) =>
            seg.type === "activity" && seg.toolCallId === toolCallId
              ? { ...seg, status: isError ? ("error" as const) : ("done" as const) }
              : seg,
          );
          return {
            ...prev,
            [projectId]: { ...existing, streamingSegments: segments },
          };
        });
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
