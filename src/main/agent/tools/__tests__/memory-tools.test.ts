import { describe, expect, it, vi } from "vitest";
import { createReadMemoryTool, createSaveMemoryTool } from "../memory-tools";

describe("createSaveMemoryTool", () => {
  it("calls saveMemoryFn with correct parameters", async () => {
    const saveMemoryFn = vi.fn().mockResolvedValue({ path: "/tmp/philosophy/test.md" });
    const tool = createSaveMemoryTool(saveMemoryFn);

    const result = await tool.execute("call-1", {
      category: "philosophy",
      title: "Test",
      content: "# Hello",
      scope: "app",
    });

    expect(saveMemoryFn).toHaveBeenCalledWith("philosophy", "Test", "# Hello", "app");
    expect((result.content[0] as { text: string }).text).toContain(
      "Saved memory to: /tmp/philosophy/test.md",
    );
  });
});

describe("createReadMemoryTool", () => {
  it("calls readMemoryFn with correct parameters", async () => {
    const readMemoryFn = vi.fn().mockResolvedValue("# Results\nFound 2 memories.");
    const tool = createReadMemoryTool(readMemoryFn);

    const result = await tool.execute("call-1", {
      category: "philosophy",
      query: "test",
      scope: "app",
    });

    expect(readMemoryFn).toHaveBeenCalledWith({
      category: "philosophy",
      query: "test",
      scope: "app",
    });
    expect((result.content[0] as { text: string }).text).toBe("# Results\nFound 2 memories.");
  });
});
