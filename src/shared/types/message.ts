export type MessageRole = "user" | "assistant" | "system";

export type ToolCallRecord = {
  toolCallId: string;
  toolName: string;
  description: string;
  status: "done" | "error";
};

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  toolCalls?: ToolCallRecord[];
};
