export type PathApprovalResult =
  | { approved: true; denyReason?: undefined }
  | { approved: false; denyReason?: string };

const pendingGates = new Map<
  string,
  { resolve: (result: PathApprovalResult) => void; timer: ReturnType<typeof setTimeout> }
>();
const timeoutHandlers = new Map<string, Set<() => void>>();

function makeKey(projectId: string, path: string, mode: string): string {
  return `${projectId}:${path}:${mode}`;
}

export function enterPathApprovalGate(
  projectId: string,
  path: string,
  mode: "read" | "write",
): Promise<PathApprovalResult> {
  return new Promise<PathApprovalResult>((resolve) => {
    const key = makeKey(projectId, path, mode);
    const timer = setTimeout(() => {
      pendingGates.delete(key);
      const handlers = timeoutHandlers.get(key);
      timeoutHandlers.delete(key);
      handlers?.forEach((handler) => {
        handler();
      });
      resolve({ approved: false });
    }, 300_000);
    pendingGates.set(key, { resolve, timer });
  });
}

export function resolvePathApprovalGate(
  projectId: string,
  path: string,
  mode: "read" | "write",
  approved: boolean,
  denyReason?: string,
): void {
  const key = makeKey(projectId, path, mode);
  const gate = pendingGates.get(key);
  if (!gate) return;
  clearTimeout(gate.timer);
  pendingGates.delete(key);
  timeoutHandlers.delete(key);
  gate.resolve(approved ? { approved: true } : { approved: false, denyReason });
}

export function onPathApprovalTimeout(
  projectId: string,
  path: string,
  mode: "read" | "write",
  handler: () => void,
): () => void {
  const key = makeKey(projectId, path, mode);
  let handlers = timeoutHandlers.get(key);
  if (!handlers) {
    handlers = new Set();
    timeoutHandlers.set(key, handlers);
  }
  handlers.add(handler);

  return () => {
    const current = timeoutHandlers.get(key);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      timeoutHandlers.delete(key);
    }
  };
}
