export type Artifact = {
  id: string;
  projectId: string;
  title: string;
  filePath: string;
  relativePath?: string;
  acknowledged: boolean;
  createdAt: Date;
};
