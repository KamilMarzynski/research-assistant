import type { Project } from "@shared/types";

export interface IProjectRepository {
  create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
  linkFolder(id: string, folderPath: string): Promise<void>;
}
