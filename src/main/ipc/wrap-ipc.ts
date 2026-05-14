import type { IpcResult } from "../../shared/ipc-types";

export async function wrapIpc<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: e.message ?? String(err), code: e.code ?? "UNKNOWN" };
  }
}
