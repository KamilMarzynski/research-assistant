import { createHash } from "node:crypto";
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

describe("read_file JSON envelope", () => {
  let tempDir: string;
  let allowlistService: AllowlistService;
  let jail: PathJail;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-tools-test-"));
    allowlistService = new AllowlistService();
    jail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        const allowed = allowlistService.isAllowed("p1", p, "read", []);
        if (!allowed.allowed) throw new ApprovalRequiredError(p, "read");
        return p;
      }),
    } as unknown as PathJail;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createReadTool() {
    return createReadFileTool(
      jail,
      undefined,
      vi.fn(),
      allowlistService,
      vi.fn().mockResolvedValue(true),
    );
  }

  it("returns JSON envelope as content text", async () => {
    const target = join(tempDir, "note.txt");
    await writeFile(target, "a\nb\nc", "utf-8");
    const tool = createReadTool();
    const result = await tool.execute("id", { path: target });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      path: target,
      mimeType: "text/plain",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      totalLines: 3,
      startLine: 1,
      endLine: 3,
      linesReturned: 3,
      truncated: false,
      hint: null,
      content: "a\nb\nc",
    });
    expect(JSON.stringify(result.details)).toBe(result.content[0].text);
  });

  it("truncates when file exceeds maxLines", async () => {
    const target = join(tempDir, "long.txt");
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    await writeFile(target, lines.join("\n"), "utf-8");
    const tool = createReadTool();
    const result = await tool.execute("id", { path: target, maxLines: 100 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.startLine).toBe(1);
    expect(parsed.endLine).toBe(100);
    expect(parsed.linesReturned).toBe(100);
    expect(parsed.hint).toContain("startLine=101");
  });

  it("handles startLine past EOF", async () => {
    const target = join(tempDir, "short.txt");
    await writeFile(target, "1\n2\n3\n4\n5", "utf-8");
    const tool = createReadTool();
    const result = await tool.execute("id", { path: target, startLine: 99 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.startLine).toBeNull();
    expect(parsed.endLine).toBeNull();
    expect(parsed.linesReturned).toBe(0);
    expect(parsed.hint).toContain("5 lines");
    expect(parsed.hint).toContain("startLine 99");
  });

  it("detects binary files", async () => {
    const target = join(tempDir, "image.png");
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(target, pngMagic);
    const tool = createReadTool();
    const result = await tool.execute("id", { path: target });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.isBinary).toBe(true);
    expect(parsed.content).toBeNull();
    expect(parsed.mimeType).toBe("image/png");
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("handles empty files", async () => {
    const target = join(tempDir, "empty.txt");
    await writeFile(target, "", "utf-8");
    const tool = createReadTool();
    const result = await tool.execute("id", { path: target });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalLines).toBe(0);
    expect(parsed.startLine).toBeNull();
    expect(parsed.endLine).toBeNull();
    expect(parsed.linesReturned).toBe(0);
    expect(parsed.content).toBe("");
    expect(parsed.sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("sha256 reflects full file, not slice", async () => {
    const target = join(tempDir, "thousand.txt");
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
    await writeFile(target, lines.join("\n"), "utf-8");
    const fullBuffer = await readFile(target);
    const fullHash = createHash("sha256").update(fullBuffer).digest("hex");
    const tool = createReadTool();
    const result = await tool.execute("id", { path: target, maxLines: 10 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sha256).toBe(fullHash);
  });

  async function readHash(target: string) {
    const readTool = createReadTool();
    const readResult = await readTool.execute("id", { path: target });
    const envelope = JSON.parse(readResult.content[0].text);
    return envelope.sha256;
  }

  function createWriteTool() {
    const writeJail = {
      projectId: "p1",
      validate: vi.fn((p: string) => {
        const allowed = allowlistService.isAllowed("p1", p, "write", []);
        if (!allowed.allowed) throw new ApprovalRequiredError(p, "write");
        return p;
      }),
    } as unknown as PathJail;

    return createWriteFileTool(
      writeJail,
      tempDir,
      undefined,
      vi.fn(),
      allowlistService,
      vi.fn().mockResolvedValue(true),
    );
  }

  it("write_file succeeds using sha256 from read_file", async () => {
    const target = join(tempDir, "roundtrip.txt");
    await writeFile(target, "original line 1\noriginal line 2\noriginal line 3", "utf-8");

    const fileHash = await readHash(target);
    const writeTool = createWriteTool();

    const writeResult = await writeTool.execute("id", {
      path: target,
      content: "replaced line 1",
      intent: "test",
      start_line: 1,
      end_line: 1,
      expected_hash: fileHash,
    });
    expect(getText(writeResult)).toContain("Edited:");
  });

  it("write_file rejects when expected_hash is stale", async () => {
    const target = join(tempDir, "roundtrip.txt");
    await writeFile(target, "original line 1\noriginal line 2\noriginal line 3", "utf-8");

    const fileHash = await readHash(target);
    const writeTool = createWriteTool();

    await writeFile(target, "mutated content\nline 2\nline 3", "utf-8");

    const staleWriteResult = await writeTool.execute("id", {
      path: target,
      content: "replaced line 1",
      intent: "test",
      start_line: 1,
      end_line: 1,
      expected_hash: fileHash,
    });
    expect(getText(staleWriteResult)).toContain("File changed since last read");
  });
});
