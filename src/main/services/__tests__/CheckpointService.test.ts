import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResearchCheckpoint } from "../CheckpointService";
import { CheckpointService } from "../CheckpointService";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join("/tmp", `checkpoint-test-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const svc = new CheckpointService();

function makeCheckpoint(override: Partial<ResearchCheckpoint> = {}): ResearchCheckpoint {
  return {
    taskId: "task-1",
    agentType: "researcher",
    researchOutput: "partial output",
    messages: [
      { role: "user", content: "research topic", timestamp: 1000 },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will research..." }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet",
        usage: {
          input: 10,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 30,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2000,
      },
    ],
    savedAt: new Date().toISOString(),
    ...override,
  };
}

describe("CheckpointService", () => {
  it("write then read returns the same checkpoint", async () => {
    const cp = makeCheckpoint();
    await svc.write(tmpDir, cp);
    const result = await svc.read(tmpDir);
    expect(result).toEqual(cp);
  });

  it("read returns null when checkpoint does not exist", async () => {
    const result = await svc.read(tmpDir);
    expect(result).toBeNull();
  });

  it("delete removes the checkpoint file", async () => {
    await svc.write(tmpDir, makeCheckpoint());
    await svc.delete(tmpDir);
    const result = await svc.read(tmpDir);
    expect(result).toBeNull();
  });

  it("delete is a no-op when file does not exist", async () => {
    await expect(svc.delete(tmpDir)).resolves.not.toThrow();
  });

  it("write overwrites an existing checkpoint", async () => {
    await svc.write(tmpDir, makeCheckpoint({ researchOutput: "first" }));
    await svc.write(tmpDir, makeCheckpoint({ researchOutput: "second" }));
    const result = await svc.read(tmpDir);
    expect(result?.researchOutput).toBe("second");
  });

  it("read returns null for corrupt JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tmpDir, "checkpoint.json"), "not valid json");
    const result = await svc.read(tmpDir);
    expect(result).toBeNull();
  });
});
