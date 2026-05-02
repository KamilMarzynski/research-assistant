import type { AgentSession } from "../agent/session";

/**
 * Owns the per-project AgentSession Map.
 * Created per-window in register.ts, not a DI singleton.
 */
export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>();

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  set(id: string, session: AgentSession): void {
    this.sessions.set(id, session);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  clear(): void {
    this.sessions.clear();
  }
}
