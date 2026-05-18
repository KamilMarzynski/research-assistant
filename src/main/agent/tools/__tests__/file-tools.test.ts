import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowlistService, ApprovalRequiredError } from "../../../services/AllowlistService";
import type { PathJail } from "../../path-jail";
import { createListDirTool, createReadFileTool, createWriteFileTool } from "../file-tools";

function getText(result: { content: Array<{ type: string; text?: string }> }) {
  return result.content[0]?.text ?? "";
}

describe("file tools approval bypass", () => {
  let tempDir: string;
  let allowlistService: AllowlistService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-tools-test-"));
    allowlistService = new AllowlistService();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("read_file bypasses approval and reads the file", async () => {
    const target = join(tempDir, "note.txt");
    await writeFile(target, "hello", "utf-8");
    const emitApprovalRequired = vi.fn();
    const jail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        const allowed = allowlistService.isAllowed("p1", p, "read", []);
        if (!allowed.allowed) throw new ApprovalRequiredError(p, "read");
        return p;
      }),
    } as unknown as PathJail;
    const tool = createReadFileTool(
      jail,
      undefined,
      emitApprovalRequired,
      allowlistService,
      vi.fn().mockResolvedValue(true),
    );

    const result = await tool.execute("tool-call", { path: target });

    expect(result.details.content).toBe("hello");
    expect(emitApprovalRequired).not.toHaveBeenCalled();
  });

  it("write_file bypasses approval and writes the file", async () => {
    const target = join(tempDir, "draft.txt");
    const emitApprovalRequired = vi.fn();
    const jail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        const allowed = allowlistService.isAllowed("p1", p, "write", []);
        if (!allowed.allowed) throw new ApprovalRequiredError(p, "write");
        return p;
      }),
    } as unknown as PathJail;
    const tool = createWriteFileTool(
      jail,
      tempDir,
      undefined,
      emitApprovalRequired,
      allowlistService,
      vi.fn().mockResolvedValue(true),
    );

    const result = await tool.execute("tool-call", {
      path: target,
      content: "draft",
      intent: "write draft",
    });

    expect(getText(result)).toContain("Written:");
    expect(await readFile(target, "utf-8")).toBe("draft");
    expect(emitApprovalRequired).not.toHaveBeenCalled();
  });

  it("list_dir bypasses approval and lists the directory", async () => {
    const targetDir = join(tempDir, "docs");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "a.txt"), "a", "utf-8");
    const emitApprovalRequired = vi.fn();
    const jail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        const allowed = allowlistService.isAllowed("p1", p, "read", []);
        if (!allowed.allowed) throw new ApprovalRequiredError(p, "read");
        return p;
      }),
    } as unknown as PathJail;
    const tool = createListDirTool(
      jail,
      emitApprovalRequired,
      allowlistService,
      vi.fn().mockResolvedValue(true),
    );

    const result = await tool.execute("tool-call", { path: targetDir });

    expect(result.details).toEqual(["a.txt"]);
    expect(emitApprovalRequired).not.toHaveBeenCalled();
  });
});
