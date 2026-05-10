import type { SkillInfo } from "./ipc-channels";
import type { Artifact, Message, Project } from "./types";

/** Response from GET_SETTINGS */
export interface SettingsResponse {
  hasApiKey: boolean;
  activeProvider: "openrouter" | "openai" | "ollama";
  providerCredentials: {
    openrouter: { apiKey: string | null; defaultModel: string };
    openai: { apiKey: string | null; defaultModel: string };
    ollama: { host: string; defaultModel: string };
  };
  langfuseEnabled: boolean;
  webAccessEnabled: boolean;
  theme: "light" | "dark" | "system";
}

/** Response from CHECK_OLLAMA */
export interface CheckOllamaResponse {
  available: boolean;
  host: string;
}

/** Request for GET_PROVIDER_MODELS */
export interface GetProviderModelsRequest {
  provider: "ollama" | "openrouter" | "openai";
  host?: string;
  apiKey?: string;
}

/** Response from GET_PROVIDER_MODELS */
export interface GetProviderModelsResponse {
  models: Array<{ id: string; name: string }>;
  error?: string;
}

/** Entry in the audit log */
export interface AuditLogEntry {
  ts: string;
  projectId: string;
  intent: string;
  command: string;
  exitCode: number | null;
  blocked?: boolean;
  blockReason?: string;
  blockKey?: string;
  blockCategory?: string;
}

/** Pending tool from GET_PENDING_TOOLS */
export interface PendingTool {
  name: string;
  skillContent: string;
}

/** Payload for BASH_BLOCKED push event */
export interface BlockedCommandPayload {
  commandId: string;
  command: string;
  reason: string;
  category: string;
  key: string;
  projectId: string;
  intent: string;
  timestamp: string;
}

/** Payload for PATH_APPROVAL_REQUIRED push event */
export interface PathApprovalPayload {
  path: string;
  mode: "read" | "write";
  projectId: string;
}

/** Payload for RESEARCH_COMPLETE push event */
export interface ResearchCompletePayload {
  taskId: string;
  artifactId?: string;
  projectId: string;
  query: string;
  filePaths: string[];
}

/** Payload for RESEARCH_STATUS_UPDATE push event */
export type ResearchStatusUpdatePayload =
  | { status: "started"; taskId: string; projectId: string; query: string }
  | { status: "progress"; taskId: string; message: string; label?: string }
  | { status: "failed"; taskId: string; projectId: string; query: string; error: string };

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

/** Typed response map for invoke() channels */
export interface IpcResponseMap {
  GET_PROJECTS: Project[];
  CREATE_PROJECT: Project;
  RENAME_PROJECT: undefined;
  DELETE_PROJECT: undefined;
  GET_ARTIFACTS: Artifact[];
  GET_MESSAGES: Message[];
  GET_SETTINGS: SettingsResponse;
  SAVE_SETTINGS: undefined;
  OPEN_FOLDER_DIALOG: string | null;
  LINK_FOLDER: undefined;
  UNLINK_FOLDER: undefined;
  RETRY_RESEARCH: { taskId: string };
  READ_ARTIFACT_FILE: string;
  GET_FILE_TREE: FileNode;
  GET_RECENT_OUTPUTS: Artifact[];
  ACKNOWLEDGE_OUTPUT: undefined;
  ACKNOWLEDGE_ALL_OUTPUTS: undefined;
  REVEAL_IN_FOLDER: undefined;
  GET_PENDING_TOOLS: PendingTool[];
  APPROVE_TOOL: undefined;
  REJECT_TOOL: undefined;
  GET_SKILLS: SkillInfo[];
  TOGGLE_SKILL: undefined;
  DELETE_SKILL: undefined;
  GET_AUDIT_LOG: AuditLogEntry[];
  CLEAR_AUDIT_LOG: undefined;
  RESOLVE_BLOCKED_COMMAND: undefined;
  GET_PENDING_PATH_APPROVALS: PathApprovalPayload[];
  RESOLVE_PATH_APPROVAL: undefined;
  CHECK_OLLAMA: CheckOllamaResponse;
  GET_PROVIDER_MODELS: GetProviderModelsResponse;
}
