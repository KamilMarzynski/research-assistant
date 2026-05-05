import { z } from "zod/v4";
import type {
  BlockedCommandPayload,
  ModelFallbackPayload,
  PathApprovalPayload,
  PendingTool,
  ResearchCompletePayload,
  ResearchStatusUpdatePayload,
} from "./ipc-types";

const ModelFallbackPayloadSchema = z.object({
  reason: z.string(),
  requestedModel: z.string(),
  fallbackProvider: z.string(),
});

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

export function decodeModelFallbackPayload(data: unknown): ModelFallbackPayload | null {
  return tryDecode(ModelFallbackPayloadSchema, data, "MODEL_FALLBACK");
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

export function decodeMessageChunk(data: unknown): string | null {
  if (typeof data === "string") return data;
  console.warn("[ipc-guard] Invalid MESSAGE_CHUNK payload: expected string");
  return null;
}
