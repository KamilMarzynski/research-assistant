export type ResearchStatus = 'pending' | 'running' | 'done' | 'failed';

export type ResearchTask = {
  id: string;
  projectId: string;
  query: string;
  status: ResearchStatus;
  startedAt: Date;
};
