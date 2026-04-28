import type { IpcChannel } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: {
      send(channel: IpcChannel, data?: unknown): void;
      invoke(channel: IpcChannel, data?: unknown): Promise<unknown>;
      on(channel: IpcChannel, callback: (data: unknown) => void): () => void;
      /** Test-only: fires registered on() listeners for the given channel without going through IPC. Only present when PLAYWRIGHT_TEST=1. */
      _simulateEvent?: (channel: IpcChannel, payload: unknown) => void;
    };
  }
}
