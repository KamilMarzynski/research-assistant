import { describe, expect, it } from "vitest";
import { CreateProjectSchema } from "../ipc-validation";

describe("CREATE_PROJECT payload validation", () => {
  it("requires folderPath", () => {
    const result = CreateProjectSchema.safeParse({ name: "Test" });
    expect(result.success).toBe(false);
  });

  it("accepts valid payload", () => {
    const result = CreateProjectSchema.safeParse({ name: "Test", folderPath: "/tmp/test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Test", folderPath: "/tmp/test" });
    }
  });
});
