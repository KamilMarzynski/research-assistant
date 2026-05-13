import { z } from "zod/v4";
import type {
  BlockedCommandPayload,
  PathApprovalPayload,
  PendingTool,
  ResearchCompletePayload,
  ResearchStatusUpdatePayload,
  ToolEndPayload,
  ToolStartPayload,
} from "./ipc-types";

const PathApprovalPayloadSchema = z.object({
  path: z.string(),
  mode: z.enum(["read", "write"]),
  projectId: z.string(),
});

const PendingToolSchema = z.object({
  name: z.string(),
  skillContent: z.string(),
});

const ResearchStatusUpdatePayloadSchema = z.union([
  z.object({
    status: z.literal("started"),
    taskId: z.string(),
    projectId: z.string(),
    query: z.string(),
  }),
  z.object({
    status: z.literal("progress"),
    taskId: z.string(),
    message: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    status: z.literal("failed"),
    taskId: z.string(),
    projectId: z.string(),
    query: z.string(),
    error: z.string(),
  }),
]);

const ResearchCompletePayloadSchema = z.object({
  taskId: z.string(),
  artifactId: z.string().optional(),
  projectId: z.string(),
  query: z.string(),
  filePaths: z.array(z.string()),
});

const BlockedCommandPayloadSchema = z.object({
  commandId: z.string(),
  command: z.string(),
  reason: z.string(),
  category: z.string(),
  key: z.string(),
  projectId: z.string(),
  intent: z.string(),
  timestamp: z.string(),
});

function tryDecode<T>(schema: z.ZodType<T>, data: unknown, label: string): T | null {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.warn(`[ipc-guard] Invalid ${label} payload:`, result.error.flatten());
  return null;
}

export function decodePathApprovalPayload(data: unknown): PathApprovalPayload | null {
  return tryDecode(PathApprovalPayloadSchema, data, "PATH_APPROVAL_REQUIRED");
}

export function decodePendingTool(data: unknown): PendingTool | null {
  return tryDecode(PendingToolSchema, data, "TOOL_PENDING");
}

export function decodeResearchStatusUpdatePayload(
  data: unknown,
): ResearchStatusUpdatePayload | null {
  return tryDecode(ResearchStatusUpdatePayloadSchema, data, "RESEARCH_STATUS_UPDATE");
}

export function decodeResearchCompletePayload(data: unknown): ResearchCompletePayload | null {
  return tryDecode(ResearchCompletePayloadSchema, data, "RESEARCH_COMPLETE");
}

export function decodeBlockedCommandPayload(data: unknown): BlockedCommandPayload | null {
  return tryDecode(BlockedCommandPayloadSchema, data, "BASH_BLOCKED");
}

export function decodeMessageChunk(data: unknown): { projectId: string; delta: string } | null {
  // Old string format (backward compat)
  if (typeof data === "string") return { projectId: "", delta: data };
  // New object format with projectId
  if (typeof data === "object" && data !== null && "projectId" in data && "delta" in data) {
    const d = data as { projectId: unknown; delta: unknown };
    if (typeof d.projectId === "string" && typeof d.delta === "string") {
      return { projectId: d.projectId, delta: d.delta };
    }
  }
  console.warn(
    "[ipc-guard] Invalid MESSAGE_CHUNK payload: expected string or { projectId, delta }",
  );
  return null;
}

export function decodeMessageDone(data: unknown): { projectId: string } | null {
  if (data === undefined || data === null) return { projectId: "" };
  if (typeof data === "object" && data !== null && "projectId" in data) {
    const d = data as { projectId: unknown };
    if (typeof d.projectId === "string") return { projectId: d.projectId };
  }
  console.warn("[ipc-guard] Invalid MESSAGE_DONE payload: expected null or { projectId }");
  return null;
}

export function decodeToolStart(data: unknown): ToolStartPayload | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "projectId" in data &&
    "toolCallId" in data &&
    "toolName" in data &&
    "description" in data
  ) {
    const d = data as Record<string, unknown>;
    if (
      typeof d.projectId === "string" &&
      typeof d.toolCallId === "string" &&
      typeof d.toolName === "string" &&
      typeof d.description === "string"
    ) {
      return {
        projectId: d.projectId,
        toolCallId: d.toolCallId,
        toolName: d.toolName,
        description: d.description,
      };
    }
  }
  console.warn("[ipc-guard] Invalid TOOL_START payload");
  return null;
}

export function decodeToolEnd(data: unknown): ToolEndPayload | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "projectId" in data &&
    "toolCallId" in data &&
    "toolName" in data &&
    "isError" in data
  ) {
    const d = data as Record<string, unknown>;
    if (
      typeof d.projectId === "string" &&
      typeof d.toolCallId === "string" &&
      typeof d.toolName === "string" &&
      typeof d.isError === "boolean"
    ) {
      return {
        projectId: d.projectId,
        toolCallId: d.toolCallId,
        toolName: d.toolName,
        isError: d.isError,
      };
    }
  }
  console.warn("[ipc-guard] Invalid TOOL_END payload");
  return null;
}
