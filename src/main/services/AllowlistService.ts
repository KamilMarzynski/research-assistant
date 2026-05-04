import { readFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { getResearchAssistantHome } from "../paths";

export class ApprovalRequiredError extends Error {
  readonly path: string;
  readonly mode: "read" | "write";

  constructor(path: string, mode: "read" | "write") {
    super(`Approval required for ${mode} on "${path}"`);
    this.name = "ApprovalRequiredError";
    this.path = path;
    this.mode = mode;
  }
}

export class AllowlistService {
  private sessionAllowlists = new Map<string, Set<string>>(); // projectId -> Set of resolved paths

  async getGlobalAllowlist(): Promise<string[]> {
    const home = getResearchAssistantHome();
    try {
      const content = await readFile(`${home}/config.md`, "utf-8");
      const section = content.match(/## Allowed paths[\s\S]*?(?=## |\n# |\n*$)/);
      if (!section) return [];
      return this.parseList(section[0]);
    } catch {
      return [];
    }
  }

  async getProjectAllowlist(agentsMdPath: string): Promise<string[]> {
    try {
      const content = await readFile(agentsMdPath, "utf-8");
      const section = content.match(/## Allowed paths[\s\S]*?(?=## |\n# |\n*$)/);
      if (!section) return [];
      return this.parseList(section[0]);
    } catch {
      return [];
    }
  }

  private parseList(section: string): string[] {
    const lines = section.split("\n");
    const paths: string[] = [];
    for (const line of lines) {
      const m = line.match(/^-\s+(.+)$/);
      if (m) paths.push(resolve(normalize(m[1].trim())));
    }
    return paths;
  }

  isAllowed(
    projectId: string,
    inputPath: string,
    mode: "read" | "write",
    existingZones: string[],
  ): { allowed: boolean; needsApproval: boolean } {
    const resolved = resolve(normalize(inputPath));

    // Check existing zones
    for (const zone of existingZones) {
      const zoneResolved = resolve(normalize(zone));
      if (resolved.startsWith(`${zoneResolved}/`) || resolved === zoneResolved) {
        return { allowed: true, needsApproval: false };
      }
    }

    // Check session allowlist
    const session = this.sessionAllowlists.get(projectId);
    if (session?.has(resolved)) {
      return { allowed: true, needsApproval: false };
    }

    return { allowed: false, needsApproval: true };
  }

  approveSession(projectId: string, path: string): void {
    const resolved = resolve(normalize(path));
    let set = this.sessionAllowlists.get(projectId);
    if (!set) {
      set = new Set();
      this.sessionAllowlists.set(projectId, set);
    }
    set.add(resolved);
  }

  clearSession(projectId: string): void {
    this.sessionAllowlists.delete(projectId);
  }
}
