import { realpathSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { getAgentsHome, getResearchAssistantHome } from "../paths";
import { type AllowlistService, ApprovalRequiredError } from "../services/AllowlistService";
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
  private readonly readWriteZones: string[];
  private readonly readOnlyZones: string[];
  private readonly allZones: string[];

  constructor(
    readonly projectId: string,
    folderPath: string | null,
    projectName: string,
    private readonly allowlistService: AllowlistService,
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

    this.readWriteZones = [
      this.workspace,
      this.projectsDir,
      ...(this.projectFolder ? [this.projectFolder] : []),
    ];

    this.readOnlyZones = [
      this.homeSkills,
      this.agentsSkills,
      ...(this.projectAgentsSkills ? [this.projectAgentsSkills] : []),
      ...(this.projectHomeSkills ? [this.projectHomeSkills] : []),
    ];

    this.allZones = [...this.readWriteZones, ...this.readOnlyZones];
  }

  private isInZone(target: string, zones: string[]): boolean {
    return zones.some((z) => target.startsWith(`${z}/`) || target === z);
  }

  /**
   * Walk path components from the allowed zone root to the target,
   * resolving symlinks at each step to prevent escape via symlinks.
   * If any intermediate component resolves outside allowed zones, reject.
   */
  private walkComponents(target: string): void {
    // Find which zone contains the target
    const containingZone = this.allZones.find((z) => this.isInZone(target, [z]));

    if (!containingZone) {
      // Path is not in any zone at the string level — already rejected by earlier checks.
      // This branch handles the case where walkComponents is called defensively.
      return;
    }

    // Resolve the containing zone so symlink comparisons are consistent
    const realContainingZone = (() => {
      try {
        return realpathSync(containingZone);
      } catch {
        return containingZone;
      }
    })();

    // Walk from the zone root to the target, component by component
    const rel = relative(containingZone, target);
    if (rel === "") return; // Target is the zone root itself

    const segments = rel.split("/");

    let current = containingZone;
    // We walk up to but NOT including the last segment (the file itself may not exist yet for writes)
    for (let i = 0; i < segments.length - 1; i++) {
      current = join(current, segments[i]);
      try {
        const real = realpathSync(current);
        if (!this.isInZone(real, [realContainingZone])) {
          throw new Error(
            `Path component "${current}" resolves outside allowed zones (resolved to "${real}"). Symlinks are not permitted to point outside designated areas.`,
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("resolves outside")) {
          throw err;
        }
        // ENOENT or other FS error: component doesn't exist yet. For parent dirs,
        // if they don't exist and the string is in zone, it's an attempt to create
        // dirs within the zone — that's allowed. We just can't verify realpath.
        // Continue to the next component.
      }
    }
  }

  validate(inputPath: string, mode: "read" | "write"): string {
    const resolved = resolve(normalize(inputPath));

    if (this.isInZone(resolved, this.readWriteZones)) {
      this.walkComponents(resolved);
      return resolved;
    }

    if (this.isInZone(resolved, this.readOnlyZones)) {
      if (mode === "write") {
        throw new Error(
          `Path "${resolved}" is in a read-only zone (skills directory). Use a workspace or project folder path instead.`,
        );
      }
      this.walkComponents(resolved);
      return resolved;
    }

    const result = this.allowlistService.isAllowed(this.projectId, resolved, mode, this.allZones);
    if (result.allowed) {
      this.walkComponents(resolved);
      return resolved;
    }
    if (result.needsApproval) {
      throw new ApprovalRequiredError(resolved, mode);
    }

    throw new Error(
      `Path "${resolved}" is not allowed. Permitted zones: workspace (${this.workspace}), project folder${this.projectFolder ? ` (${this.projectFolder})` : " (none linked)"}, projects dir (${this.projectsDir}), skills directories.`,
    );
  }
}
