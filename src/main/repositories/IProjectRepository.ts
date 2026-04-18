import type { Project } from "@shared/types";

export interface IProjectRepository {
  create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;

  // TODO(Run-4): add update(id: string, data: { name: string }): Promise<Project>
  // updatedAt column is in the schema but editing is deferred until the UI needs it.
}
