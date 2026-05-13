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
import { decodeMessageChunk, decodeMessageDone } from "../../shared/ipc-guards";

export interface ProjectStreamState {
  streamingContent: string | null;
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
            next[projectId] = { ...next[projectId], streamingContent: null, processing: false };
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
            streamingContent: existing?.streamingContent ?? null,
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
          next[projectId] = { ...next[projectId], streamingContent: null, processing: false };
        }
        return next;
      });
    },
    [clearTimer],
  );

  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (data) => {
      const chunk = decodeMessageChunk(data);
      if (chunk === null) return;
      const { projectId, delta } = chunk;
      if (!projectId) return;

      setStates((prev) => {
        const existing = prev[projectId];
        if (!existing) {
          return {
            ...prev,
            [projectId]: { streamingContent: delta, processing: true },
          };
        }
        return {
          ...prev,
          [projectId]: {
            ...existing,
            streamingContent: (existing.streamingContent ?? "") + delta,
            processing: true,
          },
        };
      });
      startTimer(projectId);
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, (data) => {
      const done = decodeMessageDone(data);
      if (done === null) return;
      const { projectId } = done;
      if (!projectId) return;
      endStream(projectId);
    });

    return () => {
      unsubChunk();
      unsubDone();
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
