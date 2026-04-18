export type MessageRole = 'user' | 'assistant' | 'system';

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};
