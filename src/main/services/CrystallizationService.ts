import { inject, injectable } from "tsyringe";
import { resolveProvider } from "../agent/model-provider";
import { createWorkerAgent } from "../agent/worker-agent";
import { AllowlistService } from "./AllowlistService";
import { HomeService } from "./HomeService";
import { SettingsService } from "./SettingsService";

export interface CrystallizationResult {
  crystallize: boolean;
  skillName?: string;
  skillDescription?: string;
}

@injectable()
export class CrystallizationService {
  constructor(
    @inject(SettingsService) private readonly settingsService: SettingsService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
  ) {}

  async evaluateForCrystallization(
    query: string,
    projectId: string,
    projectName: string,
    folderPath: string | null,
  ): Promise<CrystallizationResult | null> {
    const settings = await this.settingsService.getSettings();
    const provider = resolveProvider({ settings, forceCloud: true });

    const { run } = await createWorkerAgent({
      toolNames: ["read_file", "safe_bash"],
      systemPromptAddition:
        "You are a skill evaluator. Assess whether a completed research task produced a novel, reusable workflow. Respond with JSON only.",
      skills: ["evaluate-research"],
      projectId,
      projectName,
      projectPath: null,
      folderPath,
      homePath: this.homeService.getHomePath(),
      provider,
      remainingDepth: 0,
      webAccessEnabled: settings.webAccessEnabled,
      allowlistService: this.allowlistService,
    });

    const prompt = `Research query: "${query}"\n\nWas this approach novel, reusable, and >3 tool calls?\nRespond with JSON: { crystallize: boolean, reason: string, skillName?: string, skillDescription?: string }`;

    const output = await run(prompt);
    try {
      const parsed = JSON.parse(output) as {
        crystallize?: boolean;
        reason?: string;
        skillName?: string;
        skillDescription?: string;
      };
      if (parsed.crystallize) {
        return {
          crystallize: true,
          skillName: parsed.skillName,
          skillDescription: parsed.skillDescription,
        };
      }
    } catch {
      // JSON parse failed, skip crystallization
    }
    return null;
  }
}
