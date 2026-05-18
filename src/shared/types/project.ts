export type ApprovalLevel = "default" | "bypass_approvals";

export type Project = {
  id: string;
  name: string;
  slug: string | null;
  folderPath: string | null;
  projectPath: string | null;
  modelOverride: string | null;
  approvalLevel: ApprovalLevel;
  maxRecentMessages: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelPreset = {
  id: string;
  name: string;
  provider: "openrouter";
  modelId: string;
};
