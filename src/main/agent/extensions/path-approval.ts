const pendingGates = new Map<
  string,
  { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }
>();

function makeKey(projectId: string, path: string, mode: string): string {
  return `${projectId}:${path}:${mode}`;
}

export function enterPathApprovalGate(
  projectId: string,
  path: string,
  mode: "read" | "write",
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const key = makeKey(projectId, path, mode);
    const timer = setTimeout(() => {
      pendingGates.delete(key);
      resolve(false);
    }, 300_000);
    pendingGates.set(key, { resolve, timer });
  });
}

export function resolvePathApprovalGate(
  projectId: string,
  path: string,
  mode: "read" | "write",
  approved: boolean,
): void {
  const key = makeKey(projectId, path, mode);
  const gate = pendingGates.get(key);
  if (!gate) return;
  clearTimeout(gate.timer);
  pendingGates.delete(key);
  gate.resolve(approved);
}
