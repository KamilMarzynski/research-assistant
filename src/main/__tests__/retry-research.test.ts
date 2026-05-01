import { describe, expect, it } from "vitest";

describe("RETRY_RESEARCH payload validation", () => {
  function validateRetryPayload(payload: unknown): {
    projectId: string;
    query: string;
  } {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string" ||
      typeof (payload as { query?: unknown }).query !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId, query, ... }");
    }
    const { projectId, query } = payload as { projectId: string; query: string };
    return { projectId, query };
  }

  it("accepts valid payload with projectId and query", () => {
    const result = validateRetryPayload({ projectId: "p1", query: "test query" });
    expect(result).toEqual({ projectId: "p1", query: "test query" });
  });

  it("rejects null payload", () => {
    expect(() => validateRetryPayload(null)).toThrow("Invalid payload");
  });

  it("rejects payload with missing projectId", () => {
    expect(() => validateRetryPayload({ query: "test" })).toThrow("Invalid payload");
  });

  it("rejects non-string query", () => {
    expect(() => validateRetryPayload({ projectId: "p1", query: 123 })).toThrow("Invalid payload");
  });

  it("accepts payload with extra fields", () => {
    const result = validateRetryPayload({
      projectId: "p1",
      query: "test",
      folderPath: "/tmp",
      taskId: "t1",
    });
    expect(result).toEqual({ projectId: "p1", query: "test" });
  });
});
