import { z } from "zod/v4";

// ── IPC payload schemas ──

export const CreateProjectSchema = z.object({
  name: z.string(),
  folderPath: z.string().nullable().optional(),
});

export const ProjectIdSchema = z.object({
  projectId: z.string(),
});

export const ReadArtifactFileSchema = z.object({
  filePath: z.string(),
  projectId: z.string(),
});

export const SendMessageSchema = z.object({
  projectId: z.string(),
  content: z.string(),
});

export const RetryResearchSchema = z.object({
  projectId: z.string(),
  query: z.string(),
});

export const SaveSettingsSchema = z
  .object({
    activeProvider: z.string().optional(),
    defaultCloudProvider: z.string().optional(),
    providerCredentials: z.unknown().optional(),
    langfuseEnabled: z.boolean().optional(),
    webAccessEnabled: z.boolean().optional(),
  })
  .passthrough();

export const CheckOllamaSchema = z.string();

export const LinkFolderSchema = z.object({
  projectId: z.string(),
  folderPath: z.string(),
});

export const RenameProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const DeleteProjectSchema = z.object({
  id: z.string(),
});

export const UnlinkFolderSchema = z.object({
  id: z.string(),
});

export const ResolveBlockedCommandSchema = z.object({
  commandId: z.string(),
  action: z.enum(["approve_once", "approve_session", "deny"]),
  projectId: z.string().optional(),
});

export const ApproveRejectToolSchema = z.object({
  name: z.string(),
});

export const ToggleSkillSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
});

export const DeleteSkillSchema = z.object({
  name: z.string(),
});
