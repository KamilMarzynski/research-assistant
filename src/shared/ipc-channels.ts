export const IPC = {
  // renderer → main (invoke — request/response)
  GET_PROJECTS: "GET_PROJECTS",
  CREATE_PROJECT: "CREATE_PROJECT",
  GET_ARTIFACTS: "GET_ARTIFACTS",
  GET_MESSAGES: "GET_MESSAGES",
  GET_SETTINGS: "GET_SETTINGS",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  OPEN_FOLDER_DIALOG: "OPEN_FOLDER_DIALOG",
  LINK_FOLDER: "LINK_FOLDER",
  RENAME_PROJECT: "RENAME_PROJECT",
  DELETE_PROJECT: "DELETE_PROJECT",
  UNLINK_FOLDER: "UNLINK_FOLDER",
  READ_ARTIFACT_FILE: "READ_ARTIFACT_FILE",
  GET_RECENT_OUTPUTS: "GET_RECENT_OUTPUTS",
  ACKNOWLEDGE_OUTPUT: "ACKNOWLEDGE_OUTPUT",
  ACKNOWLEDGE_ALL_OUTPUTS: "ACKNOWLEDGE_ALL_OUTPUTS",
  REVEAL_IN_FOLDER: "REVEAL_IN_FOLDER",

  // renderer → main (send — fire-and-forget)
  SEND_MESSAGE: "SEND_MESSAGE",

  // renderer → main (retry failed research)
  RETRY_RESEARCH: "RETRY_RESEARCH",

  // renderer → main (pending tools)
  GET_PENDING_TOOLS: "GET_PENDING_TOOLS",
  APPROVE_TOOL: "APPROVE_TOOL",
  REJECT_TOOL: "REJECT_TOOL",
  GET_SKILLS: "GET_SKILLS",
  TOGGLE_SKILL: "TOGGLE_SKILL",
  DELETE_SKILL: "DELETE_SKILL",

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  RESEARCH_STATUS_UPDATE: "RESEARCH_STATUS_UPDATE",
  RESEARCH_COMPLETE: "RESEARCH_COMPLETE",
  TOOL_PENDING: "TOOL_PENDING",
  BASH_BLOCKED: "BASH_BLOCKED",

  // renderer → main (blocked command resolution)
  RESOLVE_BLOCKED_COMMAND: "RESOLVE_BLOCKED_COMMAND",

  // renderer → main (path approval)
  GET_PENDING_PATH_APPROVALS: "GET_PENDING_PATH_APPROVALS",
  RESOLVE_PATH_APPROVAL: "RESOLVE_PATH_APPROVAL",

  // main → renderer (path approval push)
  PATH_APPROVAL_REQUIRED: "PATH_APPROVAL_REQUIRED",

  // Audit log
  GET_AUDIT_LOG: "GET_AUDIT_LOG",
  CLEAR_AUDIT_LOG: "CLEAR_AUDIT_LOG",

  // File tree
  GET_FILE_TREE: "GET_FILE_TREE",

  // Model provider
  CHECK_OLLAMA: "CHECK_OLLAMA",
  GET_PROVIDER_MODELS: "GET_PROVIDER_MODELS",
  MODEL_FALLBACK: "MODEL_FALLBACK",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

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
