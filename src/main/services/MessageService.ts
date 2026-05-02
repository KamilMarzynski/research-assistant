import { inject, injectable } from "tsyringe";
import type { Message, MessageRole } from "../../shared/types";
import { MESSAGE_REPO_TOKEN } from "../di/tokens";
import type { IMessageRepository } from "../repositories/IMessageRepository";

const VALID_ROLES = new Set<MessageRole>(["user", "assistant", "system"]);

@injectable()
export class MessageService {
  constructor(@inject(MESSAGE_REPO_TOKEN) private readonly repo: IMessageRepository) {}

  async addMessage(data: Omit<Message, "id" | "createdAt">): Promise<Message> {
    if (!VALID_ROLES.has(data.role)) {
      throw new Error(
        `Invalid message role: "${data.role}". Must be one of: user, assistant, system`,
      );
    }
    return this.repo.create(data);
  }

  async getHistory(projectId: string): Promise<Message[]> {
    return this.repo.listByProject(projectId);
  }

  async getRecentContext(projectId: string, n: number): Promise<Message[]> {
    return this.repo.getRecent(projectId, n);
  }
}
