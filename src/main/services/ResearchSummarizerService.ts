import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { ModelProvider } from "../agent/model-provider";
import { AGENT_TYPE_PRESETS, createWorkerAgent } from "../agent/worker-agent";
import { EventBus } from "../event-bus";
import { AllowlistService } from "./AllowlistService";
import { HomeService } from "./HomeService";
import { MessageService } from "./MessageService";

export interface SummarizeJob {
  projectId: string;
  projectName: string;
  query: string;
  filePaths: string[];
  taskWorkspacePath: string;
  projectPath: string | null;
  folderPath: string | null;
  slug: string;
  provider: ModelProvider;
  filesMdContent?: string;
}

@injectable()
export class ResearchSummarizerService {
  private _running = false;
  private readonly _queue: SummarizeJob[] = [];

  constructor(
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
    @inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  summarize(job: SummarizeJob): Promise<void> {
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

  private async _processJob(job: SummarizeJob): Promise<void> {
    let text: string;
    try {
      text = await this._runSummarizer(job);
    } catch (err) {
      console.error("[ResearchSummarizerService] summarizer failed:", err);
      text = this._fallbackText(job);
    }

    try {
      await this.messageService.addMessage({
        projectId: job.projectId,
        role: "assistant",
        content: text,
      });
    } catch (err) {
      console.error("[ResearchSummarizerService] failed to save message:", err);
    }

    this.eventBus.emit({
      type: "research:summary_ready",
      payload: { projectId: job.projectId, text },
    });
  }

  private async _runSummarizer(job: SummarizeJob): Promise<string> {
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

    const workerConfig = AGENT_TYPE_PRESETS.summarizer(
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
      `Files reportedly saved to: ${job.filePaths.length > 0 ? job.filePaths.join(", ") : "none"}`,
      "",
      "1. Verify the output files exist at the reported paths using read_file or list_dir.",
      "   If FILES.md specifies routing conventions, check those paths too.",
      "2. Read enough of the research output to identify 2–3 key findings.",
      "3. Write a short natural message for the user: whether it went smoothly, where the results are, and the key findings.",
      "Write ONLY the final message, nothing else.",
    ].join("\n");

    return run(taskPrompt);
  }

  private _fallbackText(job: SummarizeJob): string {
    const paths = job.filePaths.length > 0 ? job.filePaths.join(", ") : "workspace";
    return `Research complete: "${job.query}". Results saved to: ${paths}. (Summary generation failed — check files manually.)`;
  }
}
