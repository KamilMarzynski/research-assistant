import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";

export class PathJail {
  private readonly workspace: string;
  private readonly home: string;
  private readonly agentsSkills: string;
  private readonly homeSkills: string;
  private readonly projectFolder: string | null;
  private readonly projectAgentsSkills: string | null;
  private readonly projectHomeSkills: string | null;

  constructor(
    private readonly projectId: string,
    folderPath: string | null,
  ) {
    this.home = join(homedir(), ".research-assistant");
    this.workspace = join(this.home, "workspace", projectId);
    this.homeSkills = join(this.home, "skills");
    this.agentsSkills = join(homedir(), ".agents", "skills");
    this.projectFolder = folderPath;
    this.projectAgentsSkills = folderPath ? join(folderPath, ".agents", "skills") : null;
    this.projectHomeSkills = folderPath
      ? join(folderPath, ".research-assistant", "skills")
      : null;
  }

  validate(inputPath: string, mode: "read" | "write"): string {
    const resolved = resolve(normalize(inputPath));

    const readWriteZones = [this.workspace, ...(this.projectFolder ? [this.projectFolder] : [])];
    const readOnlyZones = [
      this.homeSkills,
      this.agentsSkills,
      ...(this.projectAgentsSkills ? [this.projectAgentsSkills] : []),
      ...(this.projectHomeSkills ? [this.projectHomeSkills] : []),
    ];

    const inZone = (zones: string[]) =>
      zones.some((z) => resolved.startsWith(z + "/") || resolved === z);

    if (inZone(readWriteZones)) return resolved;

    if (inZone(readOnlyZones)) {
      if (mode === "write") {
        throw new Error(
          `Path "${resolved}" is in a read-only zone (skills directory). Use a workspace or project folder path instead.`,
        );
      }
      return resolved;
    }

    throw new Error(
      `Path "${resolved}" is not allowed. Permitted zones: workspace (${this.workspace}), project folder${this.projectFolder ? ` (${this.projectFolder})` : " (none linked)"}, skills directories.`,
    );
  }
}
