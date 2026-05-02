export function parseOrThrow<T>(
  schema: {
    safeParse: (data: unknown) => { success: false; error: unknown } | { success: true; data: T };
  },
  payload: unknown,
  label: string,
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid payload for ${label}: ${String(result.error)}`);
  }
  return result.data;
}
