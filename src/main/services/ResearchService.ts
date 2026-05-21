import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { inject, injectable } from "tsyringe";
import type {
  BlockedCommandPayload,
  ExecuteCodeApprovalPayload,
  PathApprovalPayload,
} from "../../shared/ipc-types";
import { resolveProvider } from "../agent/model-provider";
import type { AgentType } from "../agent/tools";
import { AGENT_TYPE_PRESETS, createWorkerAgent } from "../agent/worker-agent";
import { EventBus } from "../event-bus";
import { AllowlistService } from "./AllowlistService";
import type { ResearchCheckpoint } from "./CheckpointService";
import { CheckpointService } from "./CheckpointService";
import { HomeService } from "./HomeService";
import { ObservabilityService } from "./ObservabilityService";
import { ProjectService } from "./ProjectService";
import type { FinishJob } from "./ResearchFinisherService";
import { ResearchFinisherService } from "./ResearchFinisherService";
import { SettingsService } from "./SettingsService";
import type { ResearchTask } from "./TaskPersistenceService";
import { TaskPersistenceService } from "./TaskPersistenceService";

interface RunResearchConfig {
  projectId: string;
  projectName: string;
  projectPath: string | null;
  query: string;
  folderPath: string | null;
}

@injectable()
export class ResearchService {
  private readonly DEFAULT_RESEARCH_DEPTH = 5;
  constructor(
    @inject(EventBus) private readonly eventBus: EventBus,
    @inject(SettingsService) private readonly settingsService: SettingsService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
    @inject(ProjectService) private readonly projectService: ProjectService,
    @inject(ObservabilityService) private readonly observabilityService: ObservabilityService,
    @inject(TaskPersistenceService)
    private readonly taskPersistence: TaskPersistenceService,
    @inject(ResearchFinisherService)
    private readonly finisherService: ResearchFinisherService,
    @inject(CheckpointService)
    private readonly checkpointService: CheckpointService,
  ) {}

  async startResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
    projectPath?: string | null,
  ): Promise<{ taskId: string }> {
    return this._runResearch(
      { projectId, projectName, projectPath: projectPath ?? null, query, folderPath },
      "researcher",
      0,
    );
  }

  async startOrchestratedResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
    projectPath?: string | null,
  ): Promise<{ taskId: string }> {
    return this._runResearch(
      { projectId, projectName, projectPath: projectPath ?? null, query, folderPath },
      "orchestrator",
      this.DEFAULT_RESEARCH_DEPTH,
    );
  }

  async resumeResearch(task: ResearchTask): Promise<void> {
    const settings = await this.settingsService.getSettings();
    const homePath = this.homeService.getHomePath();
    const project = await this.projectService.getProject(task.projectId);
    const slug = project.slug ?? task.projectId;
    const workspacePath = join(homePath, "projects", slug, "workspace", task.taskId);

    const checkpoint = await this.checkpointService.read(workspacePath);
    if (!checkpoint) {
      await this.taskPersistence.updateTaskStatus(
        task.taskId,
        "interrupted",
        "No checkpoint found",
      );
      return;
    }

    const lastMessage = checkpoint.messages[checkpoint.messages.length - 1];
    if (!lastMessage || lastMessage.role === "assistant") {
      await this.taskPersistence.updateTaskStatus(
        task.taskId,
        "interrupted",
        "Checkpoint ended on assistant turn",
      );
      return;
    }

    const provider = resolveProvider({ settings, projectModelOverride: project.modelOverride });
    if (provider.type !== "ollama" && !provider.apiKey) {
      throw new Error("No API key configured for the active provider");
    }

    const projectPath = join(homePath, "projects", slug);
    let filesMdContent: string | undefined;
    try {
      filesMdContent = await readFile(join(projectPath, "FILES.md"), "utf-8");
    } catch {
      // FILES.md not yet created — agent will write without routing conventions
    }

    const agentType = checkpoint.agentType;
    const depth = agentType === "orchestrator" ? this.DEFAULT_RESEARCH_DEPTH : 0;
    let researchOutput = checkpoint.researchOutput;

    const researchSpan = await this.observabilityService.startObservation("research", {
      asType: "agent",
      input: { query: task.query },
      metadata: { taskId: task.taskId, projectId: task.projectId, projectName: task.projectName },
    });

    const parentSpanContext = researchSpan
      ? { traceId: researchSpan.traceId, spanId: researchSpan.spanId }
      : undefined;

    const onProgress = (label: string, delta: string) => {
      if (label) {
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId: task.taskId, projectId: task.projectId, message: delta, label },
        });
      }
    };

    const base = {
      projectId: task.projectId,
      slug,
      projectName: task.projectName,
      projectPath: null,
      folderPath: task.folderPath,
      homePath,
      taskWorkspacePath: workspacePath,
      filesMdContent: filesMdContent || undefined,
      provider,
      onProgress,
      webAccessEnabled: settings.webAccessEnabled,
      emitBlocked: (payload: BlockedCommandPayload) =>
        this.eventBus.emit({ type: "bash:blocked", payload }),
      emitApprovalRequired: (payload: PathApprovalPayload) =>
        this.eventBus.emit({ type: "path:approval_required", payload }),
      emitExecuteCodeApprovalRequired: (payload: ExecuteCodeApprovalPayload) =>
        this.eventBus.emit({ type: "execute_code:approval_required", payload }),
      allowlistService: this.allowlistService,
      observabilityService: this.observabilityService,
      parentSpanContext,
      onTurnEnd: (messages: AgentMessage[]) => {
        const newCheckpoint: ResearchCheckpoint = {
          taskId: task.taskId,
          agentType,
          researchOutput,
          messages,
          savedAt: new Date().toISOString(),
        };
        void this.checkpointService
          .write(workspacePath, newCheckpoint)
          .catch((err) => console.error("[ResearchService] checkpoint write failed:", err));
      },
    };
    const workerConfig = AGENT_TYPE_PRESETS[agentType](base, workspacePath, depth);

    const { agent } = await createWorkerAgent(workerConfig);

    agent.state.messages = checkpoint.messages as AgentMessage[];

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId: task.taskId, projectId: task.projectId, query: task.query },
    });

    agent.subscribe(async (event) => {
      const e = event as {
        type: string;
        assistantMessageEvent?: { type: string; delta: string };
      };

      if (e.type === "message_update") {
        const ae = e.assistantMessageEvent;
        if (ae?.type === "text_delta") {
          researchOutput += ae.delta;
          this.eventBus.emit({
            type: "research:progress",
            payload: { taskId: task.taskId, projectId: task.projectId, message: ae.delta },
          });
        }
      } else if (e.type === "agent_end") {
        researchSpan?.update({
          output: { status: "complete" },
          metadata: { taskId: task.taskId },
        });
        researchSpan?.end();
        try {
          await this.taskPersistence.updateTaskStatus(task.taskId, "complete");
          await this.checkpointService.delete(workspacePath);
          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId: task.taskId,
              projectId: task.projectId,
              query: task.query,
              filePaths: [],
            },
          });
          void this.finisherService
            .finish({
              projectId: task.projectId,
              projectName: task.projectName,
              query: task.query,
              researchOutput,
              taskWorkspacePath: workspacePath,
              projectPath: null,
              folderPath: task.folderPath,
              slug,
              provider,
              filesMdContent,
            } satisfies FinishJob)
            .catch((err) => console.error("[ResearchService] finisherService.finish failed:", err));
        } catch (err) {
          await this.taskPersistence.updateTaskStatus(task.taskId, "failed", String(err));
          this.eventBus.emit({
            type: "research:failed",
            payload: {
              taskId: task.taskId,
              projectId: task.projectId,
              query: task.query,
              error: String(err),
            },
          });
        }
      }
    });

    agent.continue().catch(async (err) => {
      researchSpan?.update({
        output: { status: "failed", error: String(err) },
        metadata: { taskId: task.taskId },
      });
      researchSpan?.end();
      console.error("[ResearchService] worker error:", err);
      await this.taskPersistence.updateTaskStatus(task.taskId, "failed", String(err));
      this.eventBus.emit({
        type: "research:failed",
        payload: {
          taskId: task.taskId,
          projectId: task.projectId,
          query: task.query,
          error: String(err),
        },
      });
    });
  }

  private async _runResearch(
    config: RunResearchConfig,
    agentType: AgentType,
    depth: number,
  ): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    const settings = await this.settingsService.getSettings();

    const homePath = this.homeService.getHomePath();
    const project = await this.projectService.getProject(config.projectId);
    const slug = project.slug ?? config.projectId;
    const workspacePath = join(homePath, "projects", slug, "workspace", taskId);

    await mkdir(workspacePath, { recursive: true });

    await this.taskPersistence.saveTask({
      taskId,
      projectId: config.projectId,
      projectName: config.projectName,
      query: config.query,
      folderPath: config.folderPath,
      startedAt: new Date().toISOString(),
    });

    const researchSpan = await this.observabilityService.startObservation("research", {
      asType: "agent",
      input: { query: config.query },
      metadata: { taskId, projectId: config.projectId, projectName: config.projectName },
    });

    const parentSpanContext = researchSpan
      ? { traceId: researchSpan.traceId, spanId: researchSpan.spanId }
      : undefined;

    const onProgress = (label: string, delta: string) => {
      if (label) {
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId, projectId: config.projectId, message: delta, label },
        });
      }
    };

    const provider = resolveProvider({ settings, projectModelOverride: project.modelOverride });
    if (provider.type !== "ollama" && !provider.apiKey) {
      throw new Error("No API key configured for the active provider");
    }

    const projectPath = config.projectPath ?? join(homePath, "projects", slug);
    let filesMdContent: string | undefined;
    try {
      filesMdContent = await readFile(join(projectPath, "FILES.md"), "utf-8");
    } catch {
      // FILES.md not yet created — agent will write without routing conventions
    }

    const base = {
      projectId: config.projectId,
      slug,
      projectName: config.projectName,
      projectPath: config.projectPath,
      folderPath: config.folderPath,
      homePath,
      taskWorkspacePath: workspacePath,
      filesMdContent: filesMdContent || undefined,
      provider,
      onProgress,
      webAccessEnabled: settings.webAccessEnabled,
      emitBlocked: (payload: BlockedCommandPayload) =>
        this.eventBus.emit({ type: "bash:blocked", payload }),
      emitApprovalRequired: (payload: PathApprovalPayload) =>
        this.eventBus.emit({ type: "path:approval_required", payload }),
      emitExecuteCodeApprovalRequired: (payload: ExecuteCodeApprovalPayload) =>
        this.eventBus.emit({ type: "execute_code:approval_required", payload }),
      allowlistService: this.allowlistService,
      observabilityService: this.observabilityService,
      parentSpanContext,
      onTurnEnd: (messages: AgentMessage[]) => {
        const checkpoint: ResearchCheckpoint = {
          taskId,
          agentType: agentType as "researcher" | "orchestrator",
          researchOutput,
          messages,
          savedAt: new Date().toISOString(),
        };
        void this.checkpointService
          .write(workspacePath, checkpoint)
          .catch((err) => console.error("[ResearchService] checkpoint write failed:", err));
      },
    };
    const workerConfig = AGENT_TYPE_PRESETS[agentType](base, workspacePath, depth);

    const { agent, run } = await createWorkerAgent(workerConfig);

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId: config.projectId, query: config.query },
    });

    let researchOutput = "";

    agent.subscribe(async (event) => {
      const e = event as {
        type: string;
        assistantMessageEvent?: { type: string; delta: string };
      };

      if (e.type === "message_update") {
        const ae = e.assistantMessageEvent;
        if (ae?.type === "text_delta") {
          researchOutput += ae.delta;
          this.eventBus.emit({
            type: "research:progress",
            payload: { taskId, projectId: config.projectId, message: ae.delta },
          });
        }
      } else if (e.type === "agent_end") {
        researchSpan?.update({
          output: { status: "complete" },
          metadata: { taskId },
        });
        researchSpan?.end();
        try {
          await this.taskPersistence.updateTaskStatus(taskId, "complete");

          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              projectId: config.projectId,
              query: config.query,
              filePaths: [],
            },
          });

          void this.finisherService
            .finish({
              projectId: config.projectId,
              projectName: config.projectName,
              query: config.query,
              researchOutput,
              taskWorkspacePath: workspacePath,
              projectPath: config.projectPath,
              folderPath: config.folderPath,
              slug,
              provider,
              filesMdContent,
            } satisfies FinishJob)
            .catch((err) => console.error("[ResearchService] finisherService.finish failed:", err));
        } catch (err) {
          await this.taskPersistence.updateTaskStatus(taskId, "failed", String(err));
          this.eventBus.emit({
            type: "research:failed",
            payload: {
              taskId,
              projectId: config.projectId,
              query: config.query,
              error: String(err),
            },
          });
        }
      }
    });

    run(config.query).catch(async (err) => {
      researchSpan?.update({
        output: { status: "failed", error: String(err) },
        metadata: { taskId },
      });
      researchSpan?.end();
      console.error("[ResearchService] worker error:", err);
      await this.taskPersistence.updateTaskStatus(taskId, "failed", String(err));
      await rm(workspacePath, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup; don't let cleanup failure mask the original error
      });
      this.eventBus.emit({
        type: "research:failed",
        payload: { taskId, projectId: config.projectId, query: config.query, error: String(err) },
      });
    });

    return { taskId };
  }
}
