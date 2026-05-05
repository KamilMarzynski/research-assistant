import type { Artifact } from "@shared/types";

type CreateArtifactData = Omit<Artifact, "id" | "createdAt" | "acknowledged"> & {
  acknowledged?: boolean;
};

export interface IArtifactRepository {
  create(data: CreateArtifactData): Promise<Artifact>;
  listByProject(projectId: string): Promise<Artifact[]>;
  get(id: string): Promise<Artifact | null>;
  acknowledge(id: string): Promise<void>;
  acknowledgeAllByProject(projectId: string): Promise<void>;
  findUnacknowledged(projectId: string, limit?: number): Promise<Artifact[]>;
}
