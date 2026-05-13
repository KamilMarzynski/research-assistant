import type { Message } from "@shared/types";

export interface IMessageRepository {
  create(data: Omit<Message, "id" | "createdAt">): Promise<Message>;
  updateContent(id: string, content: string): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  listByProject(projectId: string): Promise<Message[]>;
  getRecent(projectId: string, n: number): Promise<Message[]>;
}
