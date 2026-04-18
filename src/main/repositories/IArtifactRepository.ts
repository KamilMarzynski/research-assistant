import type { Artifact } from "@shared/types";

export interface IArtifactRepository {
  create(data: Omit<Artifact, "id" | "createdAt">): Promise<Artifact>;
  listByProject(projectId: string): Promise<Artifact[]>;
  get(id: string): Promise<Artifact | null>;
}
