import type { IpcChannel } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: {
      send(channel: IpcChannel, data?: unknown): void;
      invoke(channel: IpcChannel, data?: unknown): Promise<unknown>;
      on(channel: IpcChannel, callback: (data: unknown) => void): () => void;
    };
  }
}
