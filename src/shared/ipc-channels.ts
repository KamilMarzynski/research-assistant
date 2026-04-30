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

  // renderer → main (send — fire-and-forget)
  SEND_MESSAGE: "SEND_MESSAGE",

  // renderer → main (pending tools)
  GET_PENDING_TOOLS: "GET_PENDING_TOOLS",
  APPROVE_TOOL: "APPROVE_TOOL",
  REJECT_TOOL: "REJECT_TOOL",

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  RESEARCH_STATUS_UPDATE: "RESEARCH_STATUS_UPDATE",
  RESEARCH_COMPLETE: "RESEARCH_COMPLETE",
  TOOL_PENDING: "TOOL_PENDING",
  BASH_BLOCKED: "bash-blocked",

  // renderer → main (blocked command resolution)
  RESOLVE_BLOCKED_COMMAND: "resolve-blocked-command",

  // Audit log
  GET_AUDIT_LOG: "get-audit-log",
  CLEAR_AUDIT_LOG: "clear-audit-log",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface ResearchProgressPayload {
  taskId: string;
  message: string;
  label?: string;
}
