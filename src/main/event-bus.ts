import { EventEmitter } from "node:events";
import { injectable } from "tsyringe";

type AppEvent =
  | { type: "research:started"; payload: { taskId: string; projectId: string; query: string } }
  | { type: "research:progress"; payload: { taskId: string; message: string } }
  | {
      type: "research:complete";
      payload: {
        taskId: string;
        artifactId: string;
        projectId: string;
        query: string;
        filePath: string;
      };
    }
  | { type: "research:failed"; payload: { taskId: string; error: string } }
  | { type: "tool:pending"; payload: { name: string; skillContent: string } };

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
