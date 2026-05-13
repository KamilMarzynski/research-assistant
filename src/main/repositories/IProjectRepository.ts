import type { Project } from "@shared/types";

export type CreateProjectData = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "maxRecentMessages" | "modelOverride"
> & {
  maxRecentMessages?: number;
  modelOverride?: string | null;
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
  setProjectPath(id: string, projectPath: string): Promise<void>;
}
