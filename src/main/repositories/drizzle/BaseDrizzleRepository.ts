import { randomUUID } from "node:crypto";
import { inject } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { CLOCK_TOKEN, DB_TOKEN } from "../../di/tokens";
import type { MonotonicClock } from "../../utils/time";

export abstract class BaseDrizzleRepository<TSelect, TInsert, TEntity> {
  constructor(
    @inject(DB_TOKEN) protected readonly db: DrizzleDB,
    @inject(CLOCK_TOKEN) protected readonly clock: MonotonicClock,
  ) {}

  protected abstract rowToEntity(row: TSelect): TEntity;
  protected id(): string {
    return randomUUID();
  }
  protected now(): Date {
    return this.clock.now();
  }
}
