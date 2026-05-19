import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { ModelProvider } from "../agent/model-provider";
import { AGENT_TYPE_PRESETS, createWorkerAgent } from "../agent/worker-agent";
import { EventBus } from "../event-bus";
import { AllowlistService } from "./AllowlistService";
import { HomeService } from "./HomeService";
import { MessageService } from "./MessageService";

export interface FinishJob {
  projectId: string;
  projectName: string;
  query: string;
  researchOutput: string;
  taskWorkspacePath: string;
  projectPath: string | null;
  folderPath: string | null;
  slug: string;
  provider: ModelProvider;
  filesMdContent?: string;
}

function parseOutputFiles(text: string): string[] {
  const idx = text.indexOf("### Output Files");
  if (idx === -1) return [];
  const section = text.slice(idx + "### Output Files".length);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"));
}

@injectable()
export class ResearchFinisherService {
  private _running = false;
  private readonly _queue: FinishJob[] = [];

  constructor(
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
    @inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  finish(job: FinishJob): Promise<void> {
    this._queue.push(job);
    if (!this._running) {
      return this._processQueue();
    }
    return Promise.resolve();
  }

  private async _processQueue(): Promise<void> {
    this._running = true;
    try {
      while (this._queue.length > 0) {
        const job = this._queue.shift();
        if (!job) break;
        await this._processJob(job);
      }
    } finally {
      this._running = false;
    }
  }

  private async _processJob(job: FinishJob): Promise<void> {
    const movedFiles = parseOutputFiles(job.researchOutput);
    let text: string;
    try {
      text = await this._runFinisher(job);
    } catch (err) {
      console.error("[ResearchFinisherService] finisher failed:", err);
      text = this._fallbackText(job);
    }

    try {
      await this.messageService.addMessage({
        projectId: job.projectId,
        role: "assistant",
        content: text,
      });
    } catch (err) {
      console.error("[ResearchFinisherService] failed to save message:", err);
    }

    this.eventBus.emit({
      type: "research:summary_ready",
      payload: { projectId: job.projectId, text, movedFiles },
    });
  }

  private async _runFinisher(job: FinishJob): Promise<string> {
    const homePath = this.homeService.getHomePath();
    const projectPath = job.projectPath ?? join(homePath, "projects", job.slug);

    let filesMdContent = job.filesMdContent;
    if (!filesMdContent) {
      try {
        filesMdContent = await readFile(join(projectPath, "FILES.md"), "utf-8");
      } catch {
        // FILES.md not yet created — proceed without it
      }
    }

    const workerConfig = AGENT_TYPE_PRESETS.finisher(
      {
        projectId: job.projectId,
        slug: job.slug,
        projectName: job.projectName,
        projectPath: job.projectPath,
        folderPath: job.folderPath,
        homePath,
        taskWorkspacePath: job.taskWorkspacePath,
        filesMdContent,
        provider: job.provider,
        allowlistService: this.allowlistService,
      },
      job.taskWorkspacePath,
      0,
    );

    const { run } = await createWorkerAgent(workerConfig);

    const taskPrompt = [
      "Background research has completed.",
      "",
      `Query: "${job.query}"`,
      `Task workspace: ${job.taskWorkspacePath}`,
      "",
      "Research output (contains ## Handoff with declared output files):",
      "",
      job.researchOutput,
    ].join("\n");

    return run(taskPrompt);
  }

  private _fallbackText(job: FinishJob): string {
    return `Research complete: "${job.query}". Results in workspace: ${job.taskWorkspacePath}. (Completion agent failed — check files manually.)`;
  }
}
