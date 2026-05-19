import type { SkillInfo } from "./ipc-channels";
import type { ApprovalLevel, Artifact, Message, Project, ResearchTask } from "./types";

/** Unified return shape for all ipcMain.handle handlers */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/** Extensible tagged union for all agent execution progress events.
 * Adding a new event kind = one new union member here + one emitPush() call in main. */
export type AgentProgressEvent =
  // Research lifecycle (replaces RESEARCH_STATUS_UPDATE + RESEARCH_COMPLETE channels)
  | { kind: "research_started"; taskId: string; projectId: string; query: string }
  | { kind: "research_step"; taskId: string; projectId: string; message: string; label?: string }
  | {
      kind: "research_complete";
      taskId: string;
      projectId: string;
      query: string;
      artifactId?: string;
      filePaths: string[];
    }
  | { kind: "research_failed"; taskId: string; projectId: string; query: string; error: string }
  // Tool execution (replaces TOOL_START + TOOL_END channels)
  | {
      kind: "tool_call_start";
      projectId: string;
      toolCallId: string;
      toolName: string;
      description: string;
    }
  | {
      kind: "tool_call_end";
      projectId: string;
      toolCallId: string;
      toolName: string;
      isError: boolean;
    };

/** Discriminated union covering every webContents.send() call from main → renderer.
 * All push channels must have an entry here. */
export type IpcPushEvent =
  | { type: "MESSAGE_CHUNK"; projectId: string; delta: string }
  | { type: "MESSAGE_DONE"; projectId: string }
  | { type: "AGENT_PROGRESS"; event: AgentProgressEvent }
  | { type: "NEW_MESSAGE"; projectId: string; message: Message }
  | { type: "SETTINGS_UPDATED"; settings: SettingsResponse }
  | { type: "APPROVALS_AUTO_RESOLVED"; projectId: string }
  | ({ type: "BASH_BLOCKED" } & BlockedCommandPayload)
  | ({ type: "EXECUTE_CODE_APPROVAL_REQUIRED" } & ExecuteCodeApprovalPayload)
  | ({ type: "PATH_APPROVAL_REQUIRED" } & PathApprovalPayload);

/** Typed request payloads for all invoke() channels */
export interface IpcRequestMap {
  GET_PROJECTS: undefined;
  CREATE_PROJECT: { name: string; folderPath: string };
  RENAME_PROJECT: { id: string; name: string };
  DELETE_PROJECT: { id: string };
  GET_ARTIFACTS: { projectId: string };
  GET_PROJECT_ARTIFACTS: { projectId: string };
  GET_RESEARCHES: { projectId: string };
  GET_MESSAGES: { projectId: string };
  GET_SETTINGS: undefined;
  SAVE_SETTINGS: {
    activeProvider?: string;
    defaultCloudProvider?: string;
    providerCredentials?: unknown;
    langfuseEnabled?: boolean;
    webAccessEnabled?: boolean;
    theme?: "light" | "dark" | "system";
  };
  OPEN_FOLDER_DIALOG: undefined;
  LINK_FOLDER: { projectId: string; folderPath: string };
  UNLINK_FOLDER: { id: string };
  RETRY_RESEARCH: { projectId: string; query: string };
  READ_ARTIFACT_FILE: { filePath: string; projectId: string };
  GET_FILE_TREE: { projectId: string };
  REVEAL_IN_FOLDER: { filePath: string; projectId: string };
  GET_SKILLS: undefined;
  TOGGLE_SKILL: { name: string; enabled: boolean };
  DELETE_SKILL: { name: string };
  GET_AUDIT_LOG: undefined;
  CLEAR_AUDIT_LOG: undefined;
  RESOLVE_BLOCKED_COMMAND: {
    commandId: string;
    action: "approve_once" | "approve_session" | "deny";
    projectId?: string;
  };
  RESOLVE_EXECUTE_CODE_APPROVAL: {
    executionId: string;
    action: "approve_once" | "deny";
  };
  GET_PENDING_PATH_APPROVALS: undefined;
  RESOLVE_PATH_APPROVAL: {
    path: string;
    mode: "read" | "write";
    action: "approve_once" | "approve_session" | "deny";
    projectId: string;
  };
  CHECK_OLLAMA: string;
  GET_PROVIDER_MODELS: GetProviderModelsRequest;
  SEND_MESSAGE: { projectId: string; content: string };
  ABORT_MESSAGE: { projectId: string };
  SET_PROJECT_MODEL: { projectId: string; modelOverride: string };
  SET_PROJECT_APPROVAL_LEVEL: { projectId: string; approvalLevel: ApprovalLevel };
}

/** Response from GET_SETTINGS */
export interface SettingsResponse {
  hasApiKey: boolean;
  activeProvider: "openrouter" | "openai" | "anthropic" | "ollama";
  defaultCloudProvider: "openrouter" | "openai" | "anthropic";
  providerCredentials: {
    openrouter: { apiKey: string | null; defaultModel: string };
    openai: { apiKey: string | null; defaultModel: string };
    anthropic: { apiKey: string | null; defaultModel: string };
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
  models: Array<{
    id: string;
    name: string;
    provider: "ollama" | "openrouter" | "openai";
    maxContextWindow?: number;
    effectiveContextWindow?: number;
    maxOutputTokens?: number;
    source: "provider-api" | "provider-runtime" | "pi-ai" | "static-fallback";
  }>;
  error?: string;
}

/** Entry in the audit log */
export interface AuditLogEntry {
  ts: string;
  projectId: string;
  intent: string;
  command?: string;
  tool?: "safe_bash" | "execute_code";
  language?: "python" | "bash" | "typescript" | "javascript";
  code?: string;
  codeHash?: string;
  networkEnabled?: boolean;
  workspaceFiles?: string[];
  inlineFiles?: string[];
  outputFiles?: string[];
  exitCode: number | null;
  blocked?: boolean;
  blockReason?: string;
  blockKey?: string;
  blockCategory?: string;
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

/** Payload for EXECUTE_CODE_APPROVAL_REQUIRED push event */
export interface ExecuteCodeApprovalPayload {
  executionId: string;
  projectId: string;
  intent: string;
  language: "python" | "bash" | "typescript" | "javascript";
  code: string;
  codeHash: string;
  networkEnabled: boolean;
  workspaceFiles: string[];
  inlineFiles: string[];
  requestedPaths: Array<{ path: string; mode: "read" }>;
  timestamp: string;
}

/** Payload for PATH_APPROVAL_REQUIRED push event */
export interface PathApprovalPayload {
  path: string;
  mode: "read" | "write";
  projectId: string;
  intent?: string;
}

/** @deprecated Superseded by AgentProgressEvent. Remove when ipc-guards.ts is migrated. */
export interface ResearchCompletePayload {
  taskId: string;
  artifactId?: string;
  projectId: string;
  query: string;
  filePaths: string[];
}

/** @deprecated Superseded by AgentProgressEvent. Remove when ipc-guards.ts is migrated. */
export type ResearchStatusUpdatePayload =
  | { status: "started"; taskId: string; projectId: string; query: string }
  | { status: "progress"; taskId: string; message: string; label?: string }
  | { status: "failed"; taskId: string; projectId: string; query: string; error: string };

/** @deprecated Superseded by AgentProgressEvent. Remove when ipc-guards.ts is migrated. */
export interface ToolStartPayload {
  projectId: string;
  toolCallId: string;
  toolName: string;
  description: string;
}

/** @deprecated Superseded by AgentProgressEvent. Remove when ipc-guards.ts is migrated. */
export interface ToolEndPayload {
  projectId: string;
  toolCallId: string;
  toolName: string;
  isError: boolean;
}

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
  GET_PROJECT_ARTIFACTS: Artifact[];
  GET_RESEARCHES: ResearchTask[];
  GET_MESSAGES: Message[];
  GET_SETTINGS: SettingsResponse;
  SAVE_SETTINGS: undefined;
  OPEN_FOLDER_DIALOG: string | null;
  LINK_FOLDER: undefined;
  UNLINK_FOLDER: undefined;
  RETRY_RESEARCH: { taskId: string };
  READ_ARTIFACT_FILE: string;
  GET_FILE_TREE: FileNode;
  REVEAL_IN_FOLDER: undefined;
  GET_SKILLS: SkillInfo[];
  TOGGLE_SKILL: undefined;
  DELETE_SKILL: undefined;
  GET_AUDIT_LOG: AuditLogEntry[];
  CLEAR_AUDIT_LOG: undefined;
  RESOLVE_BLOCKED_COMMAND: undefined;
  RESOLVE_EXECUTE_CODE_APPROVAL: undefined;
  GET_PENDING_PATH_APPROVALS: PathApprovalPayload[];
  RESOLVE_PATH_APPROVAL: undefined;
  CHECK_OLLAMA: CheckOllamaResponse;
  GET_PROVIDER_MODELS: GetProviderModelsResponse;
  SEND_MESSAGE: { messageId: string };
  ABORT_MESSAGE: undefined;
  SET_PROJECT_MODEL: undefined;
  SET_PROJECT_APPROVAL_LEVEL: undefined;
}
