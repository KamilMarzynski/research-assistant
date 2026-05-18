import type { ApprovalLevel, Project } from "@shared/types";

export type CreateProjectData = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "maxRecentMessages" | "modelOverride" | "approvalLevel"
> & {
  maxRecentMessages?: number;
  modelOverride?: string | null;
  approvalLevel?: ApprovalLevel;
};

export interface IProjectRepository {
  create(data: CreateProjectData): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
  linkFolder(id: string, folderPath: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  unlinkFolder(id: string): Promise<void>;
  setModelOverride(id: string, modelOverride: string | null): Promise<void>;
  setApprovalLevel(id: string, approvalLevel: ApprovalLevel): Promise<void>;
  setProjectPath(id: string, projectPath: string): Promise<void>;
  setSlug(id: string, slug: string): Promise<void>;
}
