import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
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

  const startStream = (projectId: string) => {
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
  };

  const endStream = (projectId: string) => {
    setStates((prev) => {
      const next = { ...prev };
      if (next[projectId]) {
        next[projectId] = { ...next[projectId], streamingContent: null, processing: false };
      }
      return next;
    });
  };

  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (data) => {
      const chunk = decodeMessageChunk(data);
      if (chunk === null) return;
      const { projectId, delta } = chunk;
      if (!projectId) return;

      setStates((prev) => {
        const existing = prev[projectId];
        if (!existing) {
          // Chunk arrived without explicit start — create state on the fly
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
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, (data) => {
      const done = decodeMessageDone(data);
      if (done === null) return;
      const { projectId } = done;
      if (!projectId) return;

      setStates((prev) => {
        const next = { ...prev };
        if (next[projectId]) {
          next[projectId] = { ...next[projectId], streamingContent: null, processing: false };
        }
        return next;
      });
    });

    return () => {
      unsubChunk();
      unsubDone();
    };
  }, []);

  return (
    <StreamStateContext.Provider value={{ states, startStream, endStream }}>
      {children}
    </StreamStateContext.Provider>
  );
}

export function useStreamState(): StreamStateContextValue {
  return useContext(StreamStateContext);
}
