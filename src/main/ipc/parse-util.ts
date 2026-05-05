import type { z } from "zod/v4";

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  label: string,
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid payload for ${label}: ${String(result.error)}`);
  }
  return result.data;
}
