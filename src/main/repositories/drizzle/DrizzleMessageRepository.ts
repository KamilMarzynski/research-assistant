import { asc, desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { Message, MessageRole } from "../../../shared/types";
import type { DrizzleDB } from "../../db/client";
import { messages } from "../../db/schema";
import { DB_TOKEN } from "../../di/tokens";
import type { IMessageRepository } from "../IMessageRepository";

@injectable()
export class DrizzleMessageRepository implements IMessageRepository {
  private lastTimestamp = 0;

  private monotonicNow(): Date {
    const ts = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return new Date(ts);
  }

  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      projectId: data.projectId,
      role: data.role,
      content: data.content,
      createdAt: this.monotonicNow(),
    };
    await this.db.insert(messages).values({
      id: message.id,
      projectId: message.projectId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    });
    return message;
  }

  async listByProject(projectId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.projectId, projectId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return rows.map(this.rowToMessage);
  }

  async getRecent(projectId: string, n: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.projectId, projectId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(n);
    // Fetched newest-first; return in ascending order for callers
    return rows.map(this.rowToMessage).reverse();
  }

  private rowToMessage = (row: typeof messages.$inferSelect): Message => ({
    id: row.id,
    projectId: row.projectId,
    role: row.role as MessageRole,
    content: row.content,
    createdAt: row.createdAt,
  });
}
