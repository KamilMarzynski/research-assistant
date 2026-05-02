import type { IpcChannel, IpcResponseMap } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: {
      send(channel: IpcChannel, data?: unknown): void;
      invoke<T extends keyof IpcResponseMap>(
        channel: T,
        data?: unknown,
      ): Promise<IpcResponseMap[T]>;
      invoke(channel: IpcChannel, data?: unknown): Promise<unknown>;
      on(channel: IpcChannel, callback: (data: unknown) => void): () => void;
      generateUuid(): string;
      /** Test-only: fires registered on() listeners for the given channel without going through IPC. Only present when NODE_ENV="test". */
      _simulateEvent?: (channel: IpcChannel, payload: unknown) => void;
    };
  }
}
