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
  private readonly readWriteZones: string[];
  private readonly protectedZones: string[];

  constructor(
    readonly projectId: string,
    folderPath: string | null,
    projectPath: string | null,
    private readonly allowlistService: AllowlistService,
  ) {
    this.home = getScholarHome();
    this.workspace = join(this.home, "workspace", projectId);
    this.homeSkills = join(this.home, "skills");
    this.projectFolder = folderPath ? resolve(normalize(folderPath)) : null;
    this.allProjectsDir = join(this.home, "projects");
    this.projectSkills = projectPath ? join(projectPath, "skills") : this.allProjectsDir;
    this.projectsDir = projectPath ?? this.allProjectsDir;

    this.readWriteZones = [
      this.workspace,
      this.projectsDir,
      this.projectSkills,
      ...(this.projectFolder ? [this.projectFolder] : []),
    ];

    this.protectedZones = [
      this.workspace,
      this.projectsDir,
      this.projectSkills,
      this.homeSkills,
      this.allProjectsDir,
      ...(this.projectFolder ? [this.projectFolder] : []),
    ];
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
    const containingZone = this.protectedZones.find((z) => this.isInZone(target, [z]));

    if (!containingZone) {
      // Path is not in any protected zone — no symlink check needed.
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

    // READ MODE: allow everywhere, with symlink checks inside protected zones
    if (mode === "read") {
      if (this.isInZone(resolved, this.protectedZones)) {
        this.walkComponents(resolved);
      }
      return resolved;
    }

    // WRITE MODE: check restrictions

    // 1. Cross-project write protection (hard block, no allowlist override)
    if (
      this.isInZone(resolved, [this.allProjectsDir]) &&
      !this.isInZone(resolved, [this.projectsDir])
    ) {
      throw new Error(
        `Path "${resolved}" is outside the current project. Write to your own project directory or workspace instead.`,
      );
    }

    // 2. Read-write zones
    if (this.isInZone(resolved, this.readWriteZones)) {
      this.walkComponents(resolved);
      return resolved;
    }

    // 3. Allowlist — checked before home skills so approved paths are not re-blocked
    const result = this.allowlistService.isAllowed(
      this.projectId,
      resolved,
      mode,
      this.readWriteZones,
    );
    if (result.allowed) {
      this.walkComponents(resolved);
      return resolved;
    }

    // 4. Home skills require explicit approval
    if (this.isInZone(resolved, [this.homeSkills])) {
      throw new ApprovalRequiredError(resolved, mode);
    }

    throw new ApprovalRequiredError(resolved, mode);
  }
}
