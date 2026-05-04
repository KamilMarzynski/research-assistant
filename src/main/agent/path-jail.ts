import { join, normalize, resolve } from "node:path";
import { getAgentsHome, getResearchAssistantHome } from "../paths";
import { AllowlistService, ApprovalRequiredError } from "../services/AllowlistService";
import { toSlug } from "./context";

export class PathJail {
  private readonly workspace: string;
  private readonly home: string;
  private readonly agentsSkills: string;
  private readonly homeSkills: string;
  private readonly projectFolder: string | null;
  private readonly projectAgentsSkills: string | null;
  private readonly projectHomeSkills: string | null;
  private readonly projectsDir: string;

  constructor(
    readonly projectId: string,
    folderPath: string | null,
    projectName: string,
  ) {
    this.home = getResearchAssistantHome();
    this.workspace = join(this.home, "workspace", projectId);
    this.homeSkills = join(this.home, "skills");
    this.agentsSkills = join(getAgentsHome(), "skills");
    this.projectFolder = folderPath ? resolve(normalize(folderPath)) : null;
    this.projectAgentsSkills = this.projectFolder
      ? join(this.projectFolder, ".agents", "skills")
      : null;
    this.projectHomeSkills = this.projectFolder
      ? join(this.projectFolder, ".research-assistant", "skills")
      : null;
    this.projectsDir = join(this.home, "projects", toSlug(projectName));
  }

  validate(inputPath: string, mode: "read" | "write"): string {
    const resolved = resolve(normalize(inputPath));

    const readWriteZones = [
      this.workspace,
      this.projectsDir,
      ...(this.projectFolder ? [this.projectFolder] : []),
    ];
    const readOnlyZones = [
      this.homeSkills,
      this.agentsSkills,
      ...(this.projectAgentsSkills ? [this.projectAgentsSkills] : []),
      ...(this.projectHomeSkills ? [this.projectHomeSkills] : []),
    ];

    const inZone = (zones: string[]) =>
      zones.some((z) => resolved.startsWith(`${z}/`) || resolved === z);

    if (inZone(readWriteZones)) return resolved;

    if (inZone(readOnlyZones)) {
      if (mode === "write") {
        throw new Error(
          `Path "${resolved}" is in a read-only zone (skills directory). Use a workspace or project folder path instead.`,
        );
      }
      return resolved;
    }

    const allowlistService = new AllowlistService();
    const result = allowlistService.isAllowed(this.projectId, resolved, mode, [
      ...readWriteZones,
      ...readOnlyZones,
    ]);
    if (result.allowed) return resolved;
    if (result.needsApproval) {
      throw new ApprovalRequiredError(resolved, mode);
    }

    throw new Error(
      `Path "${resolved}" is not allowed. Permitted zones: workspace (${this.workspace}), project folder${this.projectFolder ? ` (${this.projectFolder})` : " (none linked)"}, projects dir (${this.projectsDir}), skills directories.`,
    );
  }
}
