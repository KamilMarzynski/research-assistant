import type { Message } from "@shared/types";

export interface IMessageRepository {
  create(data: Omit<Message, "id" | "createdAt">): Promise<Message>;
  listByProject(projectId: string): Promise<Message[]>;
  getRecent(projectId: string, n: number): Promise<Message[]>;
}
