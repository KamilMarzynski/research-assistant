import { join } from "node:path";
import { injectable } from "tsyringe";
import { createWorkerAgent } from "../agent/worker-agent";
import type { EventBus } from "../event-bus";
import type { ArtifactService } from "./ArtifactService";
import type { HomeService } from "./HomeService";
import type { SettingsService } from "./SettingsService";

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
    const taskId = crypto.randomUUID();
    const settings = await this.settingsService.getSettings();
    if (!settings.openrouterApiKey) {
      throw new Error("No API key configured");
    }

    const homePath = this.homeService.getHomePath();
    await this.homeService.ensureWorkspaceForProject(projectId);

    await this.homeService.saveTask({
      taskId,
      projectId,
      projectName,
      query,
      folderPath,
      startedAt: new Date().toISOString(),
    });

    const systemPromptAddition = [
      "You are a background researcher. Investigate the given query thoroughly using the available tools,",
      "then write a comprehensive Markdown report to the workspace file 'output.md'.",
      "Be thorough. When done, respond with a final summary of your findings.",
    ].join(" ");

    const { agent } = await createWorkerAgent({
      toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
      systemPromptAddition,
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey: settings.openrouterApiKey,
      model: settings.model,
    });

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId, query },
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
          const outputPath = join(homePath, "workspace", projectId, "output.md");
          const artifact = await this.artifactService.saveArtifact({
            projectId,
            title: `Research: ${query.slice(0, 60)}`,
            filePath: outputPath,
          });
          await this.homeService.deleteTask(taskId);
          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              artifactId: artifact.id,
              projectId,
              query,
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

    agent.prompt(query).catch(async (err) => {
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
