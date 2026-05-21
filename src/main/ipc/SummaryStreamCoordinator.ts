import type { BrowserWindow } from "electron";
import type { EventBus } from "../event-bus";
import { emitPush } from "./emit-push";
import type { SummaryQueue } from "./SummaryQueue";
import type { SessionManager } from "./session-manager";

function splitIntoChunks(text: string, wordsPerChunk = 4): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const slice = words.slice(i, i + wordsPerChunk).join(" ");
    chunks.push(i + wordsPerChunk < words.length ? `${slice} ` : slice);
  }
  return chunks;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SummaryStreamCoordinator {
  private static readonly _activeByEventBus = new WeakMap<EventBus, SummaryStreamCoordinator>();
  private readonly _drainPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly eventBus: EventBus,
    private readonly summaryQueue: SummaryQueue,
    private readonly sessionManager: SessionManager,
    private readonly chunkDelayMs = 15,
  ) {}

  register(): void {
    SummaryStreamCoordinator._activeByEventBus.set(this.eventBus, this);

    this.eventBus.on("research:summary_ready", ({ projectId, text }) => {
      if (SummaryStreamCoordinator._activeByEventBus.get(this.eventBus) !== this) return;
      const session = this.sessionManager.get(projectId);
      session?.injectAssistantMessage(text);
      if (!session?.isProcessing()) {
        // Stream the message when chat is free; the processing case relies on
        // the DB reload triggered by the agent's own MESSAGE_DONE.
        this.summaryQueue.push(projectId, text);
        void this.drainQueue(projectId);
      }
    });
  }

  async drainQueue(projectId: string): Promise<void> {
    const existing = this._drainPromises.get(projectId);
    if (existing) {
      return existing;
    }

    const promise = this._drain(projectId);
    this._drainPromises.set(projectId, promise);
    try {
      await promise;
    } finally {
      this._drainPromises.delete(projectId);
    }
  }

  private async _drain(projectId: string): Promise<void> {
    await Promise.resolve(); // yield so concurrent callers see the promise in the map
    try {
      while (this.summaryQueue.hasItems(projectId)) {
        const text = this.summaryQueue.pop(projectId);
        if (!text) break;
        for (const chunk of splitIntoChunks(text)) {
          emitPush(this.win, { type: "MESSAGE_CHUNK", projectId, delta: chunk });
          if (this.chunkDelayMs > 0) await sleep(this.chunkDelayMs);
        }
      }
      emitPush(this.win, { type: "MESSAGE_DONE", projectId });
    } finally {
      this._drainPromises.delete(projectId);
    }
  }
}
