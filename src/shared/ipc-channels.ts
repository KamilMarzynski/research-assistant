export const IPC = {
  // renderer → main (invoke — request/response)
  GET_PROJECTS: "GET_PROJECTS",
  CREATE_PROJECT: "CREATE_PROJECT",
  GET_ARTIFACTS: "GET_ARTIFACTS",
  GET_PROJECT_ARTIFACTS: "GET_PROJECT_ARTIFACTS",
  GET_RESEARCHES: "GET_RESEARCHES",
  GET_MESSAGES: "GET_MESSAGES",
  GET_SETTINGS: "GET_SETTINGS",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  OPEN_FOLDER_DIALOG: "OPEN_FOLDER_DIALOG",
  LINK_FOLDER: "LINK_FOLDER",
  RENAME_PROJECT: "RENAME_PROJECT",
  DELETE_PROJECT: "DELETE_PROJECT",
  UNLINK_FOLDER: "UNLINK_FOLDER",
  READ_ARTIFACT_FILE: "READ_ARTIFACT_FILE",
  REVEAL_IN_FOLDER: "REVEAL_IN_FOLDER",

  // renderer → main (send — fire-and-forget)
  SEND_MESSAGE: "SEND_MESSAGE",

  // renderer → main (retry failed research)
  RETRY_RESEARCH: "RETRY_RESEARCH",

  // renderer → main (pending tools)
  GET_PENDING_TOOLS: "GET_PENDING_TOOLS",
  APPROVE_TOOL: "APPROVE_TOOL",
  REJECT_TOOL: "REJECT_TOOL",
  GET_PROJECT_PENDING_TOOLS: "GET_PROJECT_PENDING_TOOLS",
  APPROVE_PROJECT_TOOL: "APPROVE_PROJECT_TOOL",
  REJECT_PROJECT_TOOL: "REJECT_PROJECT_TOOL",
  GET_SKILLS: "GET_SKILLS",
  TOGGLE_SKILL: "TOGGLE_SKILL",
  DELETE_SKILL: "DELETE_SKILL",

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  AGENT_PROGRESS: "AGENT_PROGRESS",
  TOOL_PENDING: "TOOL_PENDING",
  BASH_BLOCKED: "BASH_BLOCKED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  PATH_APPROVAL_REQUIRED: "PATH_APPROVAL_REQUIRED",

  // renderer → main (blocked command resolution)
  RESOLVE_BLOCKED_COMMAND: "RESOLVE_BLOCKED_COMMAND",

  // renderer → main (path approval)
  GET_PENDING_PATH_APPROVALS: "GET_PENDING_PATH_APPROVALS",
  RESOLVE_PATH_APPROVAL: "RESOLVE_PATH_APPROVAL",

  // Audit log
  GET_AUDIT_LOG: "GET_AUDIT_LOG",
  CLEAR_AUDIT_LOG: "CLEAR_AUDIT_LOG",

  // File tree
  GET_FILE_TREE: "GET_FILE_TREE",

  // Model provider
  CHECK_OLLAMA: "CHECK_OLLAMA",
  GET_PROVIDER_MODELS: "GET_PROVIDER_MODELS",
  SET_PROJECT_MODEL: "SET_PROJECT_MODEL",

  ABORT_MESSAGE: "ABORT_MESSAGE",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// TODO: remove — superseded by AgentProgressEvent["research_step"]
export interface ResearchProgressPayload {
  taskId: string;
  message: string;
  label?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  protected: boolean;
  content: string;
}

export * from "./ipc-types";
