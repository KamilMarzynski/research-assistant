import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { injectable } from "tsyringe";
import { buildSystemContext } from "../agent/context";
import { createAgentTools } from "../agent/tools";
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

    const systemContext = await buildSystemContext(projectId, projectName, folderPath ?? undefined);

    const systemPrompt = [
      "You are a background researcher. Your job is to investigate the given query thoroughly using the available tools, then write a comprehensive Markdown report to the workspace file 'output.md'. Be thorough. When done, respond with a final summary of your findings.",
      systemContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    const worker = new Agent({
      initialState: {
        systemPrompt,
        model: getModel("openrouter", settings.model as never),
      },
      getApiKey: async () => settings.openrouterApiKey as string,
    });

    // Register tools — no start_research (no recursive dispatch)
    worker.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
    });

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId, query },
    });

    worker.subscribe(async (event) => {
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
          this.eventBus.emit({
            type: "research:failed",
            payload: { taskId, error: String(err) },
          });
        }
      }
    });

    // Fire-and-forget — caller gets taskId immediately
    worker.prompt(query).catch((err) => {
      console.error("[ResearchService] worker error:", err);
      this.eventBus.emit({
        type: "research:failed",
        payload: { taskId, error: String(err) },
      });
    });

    return { taskId };
  }
}
