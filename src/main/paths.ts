import { homedir } from "node:os";
import { join } from "node:path";

/** Return the home directory path lazily so tests can mock node:os before calling. */
function resolveHome(): string {
  return homedir();
}

export function getScholarHome(): string {
  return join(resolveHome(), ".scholar");
}

export function getHomePath(): string {
  return getScholarHome();
}

export function getSkillsPath(): string {
  return join(getScholarHome(), "skills");
}

export function getWorkspacePath(): string {
  return join(getScholarHome(), "workspace");
}

export function getProjectConfigPath(slug: string): string {
  return join(getScholarHome(), "projects", slug);
}
