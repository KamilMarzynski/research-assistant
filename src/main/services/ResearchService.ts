import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import { toSlug } from "../agent/context";
import { resolveProvider } from "../agent/model-provider";
import { OutputRouter } from "../agent/OutputRouter";
import { PathJail } from "../agent/path-jail";
import type { WorkerAgentConfig } from "../agent/worker-agent";
import { createWorkerAgent, ORCHESTRATOR_TOOL_NAMES } from "../agent/worker-agent";
import { EventBus } from "../event-bus";
import { AllowlistService } from "./AllowlistService";
import { ArtifactService } from "./ArtifactService";
import { CrystallizationService } from "./CrystallizationService";
import { HomeService } from "./HomeService";
import { ProjectService } from "./ProjectService";
import { SettingsService } from "./SettingsService";

interface RunResearchConfig {
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
}

@injectable()
export class ResearchService {
  /** Workspace dirs older than this get cleaned up on next research start. */
  private static readonly WORKSPACE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @inject(EventBus) private readonly eventBus: EventBus,
    @inject(SettingsService) private readonly settingsService: SettingsService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
    @inject(CrystallizationService) private readonly crystallizationService: CrystallizationService,
    @inject(ProjectService) private readonly projectService: ProjectService,
    @inject(ArtifactService) private readonly artifactService: ArtifactService,
  ) {}

  async startResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    return this._runResearch({ projectId, projectName, query, folderPath }, (_workspacePath) => ({
      toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
      systemPromptAddition: [
        "You are a background researcher. Investigate the given query thoroughly using the available tools.",
        "Create final output files in the project folder using write_file, not in the workspace.",
        "Name files meaningfully (no task IDs in filenames).",
        "Be thorough. When done, respond with a final summary of your findings.",
      ].join(" "),
      projectId,
      projectName,
      folderPath,
      homePath: this.homeService.getHomePath(),
      remainingDepth: 0,
      allowlistService: this.allowlistService,
    }));
  }

  async startOrchestratedResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    const homePath = this.homeService.getHomePath();

    return this._runResearch({ projectId, projectName, query, folderPath }, (workspacePath) => ({
      toolNames: [...ORCHESTRATOR_TOOL_NAMES],
      systemPromptAddition: [
        "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
        `Your workspace root: ${workspacePath}`,
        "Write intermediate results to subdirectories within your workspace root.",
        "Create final output files in the project folder using write_file, not in the workspace.",
        "Name files meaningfully (no task IDs in filenames).",
      ].join("\n"),
      projectId,
      projectName,
      folderPath,
      homePath,
      remainingDepth: 3,
      allowlistService: this.allowlistService,
    }));
  }

  /** Remove workspace directories older than WORKSPACE_MAX_AGE_MS. Fire-and-forget. */
  private async cleanupOldWorkspaces(): Promise<void> {
    try {
      const homePath = this.homeService.getHomePath();
      const workspaceRoot = join(homePath, "workspace");
      let entries: string[];
      try {
        entries = await readdir(workspaceRoot);
      } catch {
        return; // No workspace dir yet
      }
      const now = Date.now();
      for (const entry of entries) {
        const fullPath = join(workspaceRoot, entry);
        try {
          const stats = await stat(fullPath);
          if (stats.isDirectory() && now - stats.mtimeMs > ResearchService.WORKSPACE_MAX_AGE_MS) {
            await rm(fullPath, { recursive: true, force: true });
          }
        } catch (err) {
          console.error(`[ResearchService] workspace cleanup: skipping entry ${entry}:`, err);
        }
      }
    } catch (err) {
      console.error("[ResearchService] workspace cleanup failed:", err);
    }
  }

  private async _runResearch(
    config: RunResearchConfig,
    buildPartialConfig: (
      workspacePath: string,
    ) => Omit<WorkerAgentConfig, "provider" | "onProgress">,
  ): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    const settings = await this.settingsService.getSettings();

    const homePath = this.homeService.getHomePath();
    const workspacePath = join(homePath, "workspace", config.projectId, taskId);

    // Fire cleanup in background — don't block research start
    this.cleanupOldWorkspaces().catch((err) => {
      console.error("[ResearchService] background workspace cleanup failed:", err);
    });

    await mkdir(workspacePath, { recursive: true });

    await this.homeService.saveTask({
      taskId,
      projectId: config.projectId,
      projectName: config.projectName,
      query: config.query,
      folderPath: config.folderPath,
      startedAt: new Date().toISOString(),
    });

    const onProgress = (label: string, delta: string) => {
      if (label) {
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId, message: delta, label },
        });
      }
    };

    const project = await this.projectService.getProject(config.projectId);
    const provider = resolveProvider({ settings, projectModelOverride: project.modelOverride });
    if (provider.type !== "ollama" && !provider.apiKey) {
      throw new Error("No API key configured for the active provider");
    }

    const workerConfig: WorkerAgentConfig = {
      ...buildPartialConfig(workspacePath),
      provider,
      onProgress,
      webAccessEnabled: settings.webAccessEnabled,
      allowlistService: this.allowlistService,
    };

    const { agent } = await createWorkerAgent(workerConfig);

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId: config.projectId, query: config.query },
    });

    agent.subscribe(async (event) => {
      const e = event as {
        type: string;
        assistantMessageEvent?: { type: string; delta: string };
      };

      if (e.type === "message_update") {
        const ae = e.assistantMessageEvent;
        if (ae?.type === "text_delta") {
          this.eventBus.emit({
            type: "research:progress",
            payload: { taskId, message: ae.delta },
          });
        }
      } else if (e.type === "agent_end") {
        try {
          await this.homeService.updateTaskStatus(taskId, "complete");

          // Read AGENTS.md for output conventions
          let filePaths: string[] = [];
          try {
            const homePath = this.homeService.getHomePath();
            const slug = toSlug(config.projectName);
            let agentsMdContent = "";

            // Try linked folder first
            if (config.folderPath) {
              try {
                agentsMdContent = await readFile(join(config.folderPath, "AGENTS.md"), "utf-8");
              } catch {
                /* not found */
              }
            }

            // Fallback to app home
            if (!agentsMdContent) {
              try {
                agentsMdContent = await readFile(
                  join(homePath, "projects", slug, "AGENTS.md"),
                  "utf-8",
                );
              } catch {
                /* not found */
              }
            }

            let conventions: { default: string; code?: string; reports?: string } | null = null;
            if (agentsMdContent) {
              const jail = new PathJail(
                config.projectId,
                config.folderPath,
                config.projectName,
                this.allowlistService,
              );
              const router = new OutputRouter(jail, this.artifactService);
              conventions = router.parseConventions(agentsMdContent);
            }
            if (!conventions && config.folderPath) {
              conventions = { default: config.folderPath };
            }
            if (conventions) {
              const jail = new PathJail(
                config.projectId,
                config.folderPath,
                config.projectName,
                this.allowlistService,
              );
              const router = new OutputRouter(jail, this.artifactService);
              const result = await router.moveFinals(workspacePath, conventions);
              filePaths = result.moved.map((name) => join(conventions.default, name));
            }
          } catch (err) {
            console.error("[ResearchService] output routing failed:", err);
          }

          // Post-research: evaluate for skill crystallization
          this.crystallizationService
            .crystallizeAndSave(
              config.query,
              config.projectId,
              config.projectName,
              config.folderPath,
            )
            .catch((err) => {
              console.error("[ResearchService] crystallization failed:", err);
            });

          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              projectId: config.projectId,
              query: config.query,
              filePaths,
            },
          });
        } catch (err) {
          await this.homeService.updateTaskStatus(taskId, "failed", String(err));
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

    agent.prompt(config.query).catch(async (err) => {
      console.error("[ResearchService] worker error:", err);
      await this.homeService.updateTaskStatus(taskId, "failed", String(err));
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
