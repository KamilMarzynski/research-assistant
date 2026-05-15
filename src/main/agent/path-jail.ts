import { realpathSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { getScholarHome } from "../paths";
import { type AllowlistService, ApprovalRequiredError } from "../services/AllowlistService";

export class PathJail {
  private readonly workspace: string;
  private readonly home: string;
  private readonly homeSkills: string;
  private readonly allProjectsDir: string;
  private readonly projectFolder: string | null;
  private readonly projectSkills: string;
  private readonly projectsDir: string;
  private readonly memoriesDir: string;
  private readonly readWriteZones: string[];
  private readonly readZones: string[];

  constructor(
    readonly projectId: string,
    slug: string,
    folderPath: string | null,
    projectPath: string | null,
    private readonly allowlistService: AllowlistService,
  ) {
    this.home = getScholarHome();
    const slugBasedPath = join(this.home, "projects", slug);
    this.workspace = join(slugBasedPath, "workspace");
    this.homeSkills = join(this.home, "skills");
    this.projectFolder = folderPath ? resolve(normalize(folderPath)) : null;
    this.allProjectsDir = join(this.home, "projects");
    this.projectsDir = projectPath ? resolve(normalize(projectPath)) : slugBasedPath;
    this.projectSkills = join(this.projectsDir, "skills");
    this.memoriesDir = join(this.projectsDir, "memories");

    this.readWriteZones = [
      this.workspace,
      this.projectsDir,
      this.projectSkills,
      ...(this.projectFolder ? [this.projectFolder] : []),
    ];

    // homeSkills is readable but writes require approval
    this.readZones = [...this.readWriteZones, this.homeSkills];
  }

  private isInZone(target: string, zones: string[]): boolean {
    return zones.some((z) => target.startsWith(`${z}/`) || target === z);
  }

  // Walk path components from the zone root to the target, resolving symlinks
  // at each step to prevent escape via symlink indirection.
  private walkComponents(target: string): void {
    const containingZone = this.readZones.find((z) => this.isInZone(target, [z]));

    if (!containingZone) {
      return;
    }

    const realContainingZone = (() => {
      try {
        return realpathSync(containingZone);
      } catch {
        return containingZone;
      }
    })();

    const rel = relative(containingZone, target);
    if (rel === "") return;

    const segments = rel.split("/");

    let current = containingZone;
    // Walk up to but NOT including the last segment (target file may not exist yet)
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
        // ENOENT: component doesn't exist yet — allowed for new file creation within zone
      }
    }
  }

  validate(inputPath: string, mode: "read" | "write"): string {
    const resolved = resolve(normalize(inputPath));

    // Memories dir is always blocked — only accessible via read_memory/save_memory tools
    if (this.isInZone(resolved, [this.memoriesDir])) {
      throw new Error(
        `Direct access to "${resolved}" is not permitted. Use the read_memory and save_memory tools to access memories.`,
      );
    }

    // Writes to skills dirs require explicit user approval
    if (
      mode === "write" &&
      (this.isInZone(resolved, [this.projectSkills]) || this.isInZone(resolved, [this.homeSkills]))
    ) {
      throw new ApprovalRequiredError(resolved, mode);
    }

    // Cross-project write protection (hard block, no allowlist override)
    if (
      mode === "write" &&
      this.isInZone(resolved, [this.allProjectsDir]) &&
      !this.isInZone(resolved, [this.projectsDir])
    ) {
      throw new Error(
        `Path "${resolved}" is outside the current project. Write to your own project directory or workspace instead.`,
      );
    }

    // Symlink traversal check for any path within readable zones
    this.walkComponents(resolved);

    if (mode === "read") {
      if (this.isInZone(resolved, this.readZones)) {
        return resolved;
      }
      const result = this.allowlistService.isAllowed(
        this.projectId,
        resolved,
        mode,
        this.readZones,
      );
      if (result.allowed) return resolved;
      throw new ApprovalRequiredError(resolved, mode);
    }

    // Write mode
    if (this.isInZone(resolved, this.readWriteZones)) {
      return resolved;
    }
    const result = this.allowlistService.isAllowed(
      this.projectId,
      resolved,
      mode,
      this.readWriteZones,
    );
    if (result.allowed) return resolved;
    throw new ApprovalRequiredError(resolved, mode);
  }
}
