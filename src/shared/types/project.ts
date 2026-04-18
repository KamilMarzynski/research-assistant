export type Project = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelPreset = {
  id: string;
  name: string;
  provider: 'openrouter';
  modelId: string;
};
