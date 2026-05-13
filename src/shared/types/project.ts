export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  projectPath: string | null;
  modelOverride: string | null;
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
