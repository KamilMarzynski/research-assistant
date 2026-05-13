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

export function getProjectPath(slug: string): string {
  return join(getScholarHome(), "projects", slug);
}

export function getProjectConfigPath(slug: string): string {
  return getProjectPath(slug);
}

export function getWorkspacePath(slug: string): string {
  return join(getProjectPath(slug), "workspace");
}
