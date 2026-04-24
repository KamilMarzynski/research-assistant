import type { Project } from "@shared/types";

export type CreateProjectData = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "maxRecentMessages"
> & {
  maxRecentMessages?: number;
};

export interface IProjectRepository {
  create(data: CreateProjectData): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
  linkFolder(id: string, folderPath: string): Promise<void>;
}
