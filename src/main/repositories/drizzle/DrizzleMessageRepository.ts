import { asc, desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { Message, MessageRole } from "../../../shared/types";
import type { DrizzleDB } from "../../db/client";
import { messages } from "../../db/schema";
import { CLOCK_TOKEN, DB_TOKEN } from "../../di/tokens";
import type { MonotonicClock } from "../../utils/time";
import type { IMessageRepository } from "../IMessageRepository";
import { BaseDrizzleRepository } from "./BaseDrizzleRepository";

@injectable()
export class DrizzleMessageRepository
  extends BaseDrizzleRepository<typeof messages.$inferSelect, typeof messages.$inferInsert, Message>
  implements IMessageRepository
{
  constructor(@inject(DB_TOKEN) db: DrizzleDB, @inject(CLOCK_TOKEN) clock: MonotonicClock) {
    super(db, clock);
  }

  async create(data: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const message: Message = {
      id: this.id(),
      projectId: data.projectId,
      role: data.role,
      content: data.content,
      createdAt: this.now(),
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

  async updateContent(id: string, content: string): Promise<void> {
    await this.db.update(messages).set({ content }).where(eq(messages.id, id));
  }

  async listByProject(projectId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.projectId, projectId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return rows.map(this.rowToEntity);
  }

  async getRecent(projectId: string, n: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.projectId, projectId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(n);
    // Fetched newest-first; return in ascending order for callers
    return rows.map(this.rowToEntity).reverse();
  }

  protected rowToEntity = (row: typeof messages.$inferSelect): Message => ({
    id: row.id,
    projectId: row.projectId,
    role: row.role as MessageRole,
    content: row.content,
    createdAt: row.createdAt,
  });
}
