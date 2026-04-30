import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { injectable } from "tsyringe";
import type { WorkerAgentConfig } from "../agent/worker-agent";
import { createWorkerAgent, ORCHESTRATOR_TOOL_NAMES } from "../agent/worker-agent";
import type { EventBus } from "../event-bus";
import type { ArtifactService } from "./ArtifactService";
import type { HomeService } from "./HomeService";
import type { SettingsService } from "./SettingsService";

interface RunResearchConfig {
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
}

@injectable()
export class ResearchService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly artifactService: ArtifactService,
    private readonly settingsService: SettingsService,
    private readonly homeService: HomeService,
  ) {}

  async startResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    return this._runResearch(
      { projectId, projectName, query, folderPath },
      "output.md",
      (workspacePath) => ({
        toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
        systemPromptAddition: [
          "You are a background researcher. Investigate the given query thoroughly using the available tools,",
          `then write a comprehensive Markdown report to: ${join(workspacePath, "output.md")}.`,
          "Be thorough. When done, respond with a final summary of your findings.",
        ].join(" "),
        projectId,
        projectName,
        folderPath,
        homePath: this.homeService.getHomePath(),
        remainingDepth: 0,
      }),
    );
  }

  async startOrchestratedResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    const homePath = this.homeService.getHomePath();

    const saveArtifactFn = async (path: string, title: string) => {
      const artifact = await this.artifactService.saveArtifact({
        projectId,
        title,
        filePath: path,
      });
      return { artifactId: artifact.id };
    };

    const proposeToolFn = async (name: string, skillContent: string, script?: string) => {
      await this.homeService.savePendingTool(name, skillContent, script);
      this.eventBus.emit({ type: "tool:pending", payload: { name, skillContent } });
    };

    return this._runResearch(
      { projectId, projectName, query, folderPath },
      "synthesis.md",
      (workspacePath) => ({
        toolNames: [...ORCHESTRATOR_TOOL_NAMES],
        systemPromptAddition: [
          "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
          `Your workspace root: ${workspacePath}`,
          "Write intermediate results to subdirectories within your workspace root.",
          "Write your final synthesis to synthesis.md in your workspace root.",
          "Use save_artifact to persist valuable outputs — both intermediate and final.",
        ].join("\n"),
        projectId,
        projectName,
        folderPath,
        homePath,
        remainingDepth: 3,
        saveArtifactFn,
        proposeToolFn,
      }),
    );
  }

  private async _runResearch(
    config: RunResearchConfig,
    outputFileName: string,
    buildPartialConfig: (
      workspacePath: string,
    ) => Omit<WorkerAgentConfig, "apiKey" | "model" | "onProgress">,
  ): Promise<{ taskId: string }> {
    const taskId = crypto.randomUUID();
    const settings = await this.settingsService.getSettings();
    const cloudCreds = settings.providerCredentials.openrouter;
    if (!cloudCreds.apiKey) {
      throw new Error("No API key configured");
    }

    const homePath = this.homeService.getHomePath();
    const workspacePath = join(homePath, "workspace", config.projectId, taskId);
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

    const workerConfig: WorkerAgentConfig = {
      ...buildPartialConfig(workspacePath),
      apiKey: cloudCreds.apiKey,
      model: cloudCreds.defaultModel,
      onProgress,
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
          const outputPath = join(workspacePath, outputFileName);
          const artifact = await this.artifactService.saveArtifact({
            projectId: config.projectId,
            title: `Research: ${config.query.slice(0, 60)}`,
            filePath: outputPath,
          });
          await this.homeService.deleteTask(taskId);
          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              artifactId: artifact.id,
              projectId: config.projectId,
              query: config.query,
              filePath: outputPath,
            },
          });
        } catch (err) {
          await this.homeService.deleteTask(taskId);
          this.eventBus.emit({
            type: "research:failed",
            payload: { taskId, error: String(err) },
          });
        }
      }
    });

    agent.prompt(config.query).catch(async (err) => {
      console.error("[ResearchService] worker error:", err);
      await this.homeService.deleteTask(taskId);
      this.eventBus.emit({
        type: "research:failed",
        payload: { taskId, error: String(err) },
      });
    });

    return { taskId };
  }
}
