export class SendThrottle {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly lastSendTimes = new Map<string, number>();
  private readonly MAX_KEYS = 500;

  constructor(private readonly throttleMs: number = 500) {}

  async acquire(projectId: string): Promise<() => void> {
    // Bounded cleanup to prevent memory leak
    if (this.locks.size > this.MAX_KEYS) {
      this.locks.clear();
      this.lastSendTimes.clear();
    }

    // Wait for any in-progress send for this project BEFORE checking throttle
    // This is the key fix: serializes the throttle check itself
    const existing = this.locks.get(projectId);
    if (existing) await existing;

    // Throttle: wait until minimum interval has elapsed
    const last = this.lastSendTimes.get(projectId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < this.throttleMs) {
      await new Promise<void>((r) => setTimeout(r, this.throttleMs - elapsed));
    }
    this.lastSendTimes.set(projectId, Date.now());

    // Register lock before returning so subsequent callers wait on THIS call
    let release!: () => void;
    const lockPromise = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(projectId, lockPromise);

    const cleanup = () => {
      release();
      this.locks.delete(projectId);
    };

    return cleanup;
  }
}
