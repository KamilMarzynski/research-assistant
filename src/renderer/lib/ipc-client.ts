import type {
  AgentProgressEvent,
  IpcPushEvent,
  IpcRequestMap,
  IpcResponseMap,
  IpcResult,
} from "../../shared/ipc-types";

export type { AgentProgressEvent, IpcPushEvent };

export class IpcClient {
  async invoke<K extends keyof IpcRequestMap & keyof IpcResponseMap>(
    channel: K,
    payload?: IpcRequestMap[K],
  ): Promise<IpcResponseMap[K]> {
    const result = (await window.electronAPI.invoke(
      channel as Parameters<typeof window.electronAPI.invoke>[0],
      payload,
    )) as IpcResult<IpcResponseMap[K]>;
    if (!result.ok) {
      const err = new Error(result.error);
      (err as NodeJS.ErrnoException).code = result.code;
      throw err;
    }
    return result.data;
  }

  on<T extends IpcPushEvent["type"]>(
    type: T,
    handler: (event: Extract<IpcPushEvent, { type: T }>) => void,
  ): () => void {
    return window.electronAPI.on(type as Parameters<typeof window.electronAPI.on>[0], (data) =>
      handler(data as Extract<IpcPushEvent, { type: T }>),
    );
  }
}

export const ipc = new IpcClient();
