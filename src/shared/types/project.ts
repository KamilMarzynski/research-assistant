export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelPreset = {
  id: string;
  name: string;
  provider: "openrouter";
  modelId: string;
};
