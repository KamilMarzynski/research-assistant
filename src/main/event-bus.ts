import { EventEmitter } from "node:events";
import { injectable } from "tsyringe";

type AppEvent =
  | { type: "research:started"; payload: { taskId: string; projectId: string; query: string } }
  | { type: "research:progress"; payload: { taskId: string; message: string; label?: string } }
  | {
      type: "research:complete";
      payload: { taskId: string; projectId: string; query: string; filePaths: string[] };
    }
  | {
      type: "research:failed";
      payload: { taskId: string; projectId: string; query: string; error: string };
    }
  | { type: "tool:pending"; payload: { name: string; skillContent: string } }
  | {
      type: "bash:blocked";
      payload: {
        commandId: string;
        command: string;
        reason: string;
        category: string;
        key: string;
        projectId: string;
        intent: string;
        timestamp: string;
      };
    }
  | {
      type: "model:fallback";
      payload: { reason: string; requestedModel: string; fallbackProvider: string };
    }
  | { type: "startup:error"; payload: { phase: string; error: string } }
  | {
      type: "file:written";
      payload: {
        projectId: string;
        absolutePath: string;
        relativePath: string;
        fileName: string;
      };
    }
  | { type: "skill:changed"; payload: { skillName: string; summary: string } }
  | {
      type: "path:approval_required";
      payload: { path: string; mode: "read" | "write"; projectId: string };
    }
  | { type: "agent:chunk"; payload: { projectId: string; delta: string } }
  | { type: "agent:done"; payload: { projectId: string } };

@injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();

  emit<T extends AppEvent>(event: T): void {
    this.emitter.emit(event.type, event.payload);
  }

  on<K extends AppEvent["type"]>(
    type: K,
    handler: (payload: Extract<AppEvent, { type: K }>["payload"]) => void,
  ): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }
}
