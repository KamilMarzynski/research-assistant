import { homedir } from "node:os";
import { join } from "node:path";

/** Return the home directory path lazily so tests can mock node:os before calling. */
function resolveHome(): string {
  return homedir();
}

export function getResearchAssistantHome(): string {
  return join(resolveHome(), ".research-assistant");
}

export function getAgentsHome(): string {
  return join(resolveHome(), ".agents");
}

export function getHomePath(): string {
  return getResearchAssistantHome();
}

export function getAgentsPath(): string {
  return getAgentsHome();
}

export function getSkillsPath(): string {
  return join(getResearchAssistantHome(), "skills");
}

export function getWorkspacePath(): string {
  return join(getResearchAssistantHome(), "workspace");
}

export function getProjectSkillsPaths(projectFolderPath: string): string[] {
  return [
    join(projectFolderPath, ".agents", "skills"),
    join(projectFolderPath, ".research-assistant", "skills"),
  ];
}
