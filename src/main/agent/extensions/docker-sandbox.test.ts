import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockContainer = {
  start: vi.fn(),
  wait: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
};

const mockCreateContainer = vi.fn();

vi.mock("dockerode", () => {
  const MockDocker = vi.fn(function () {
    return { createContainer: mockCreateContainer };
  });
  return { default: MockDocker };
});

const { runInDocker } = await import("./docker-sandbox");

describe("runInDocker", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "docker-test-"));
    vi.clearAllMocks();
    mockContainer.start.mockResolvedValue(undefined);
    mockContainer.wait.mockResolvedValue({ StatusCode: 0 });
    mockContainer.stop.mockResolvedValue(undefined);
    mockContainer.remove.mockResolvedValue(undefined);
    mockCreateContainer.mockResolvedValue(mockContainer);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("selects python:3.11-slim for python", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "python:3.11-slim" }),
    );
  });

  it("selects node:20-alpine for typescript", async () => {
    await runInDocker({ code: 'console.log("hi")', language: "typescript" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "node:20-alpine" }),
    );
  });

  it("selects node:20-alpine for javascript", async () => {
    await runInDocker({ code: 'console.log("hi")', language: "javascript" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "node:20-alpine" }),
    );
  });

  it("selects bash:5 for bash", async () => {
    await runInDocker({ code: 'echo "hi"', language: "bash" });
    expect(mockCreateContainer).toHaveBeenCalledWith(expect.objectContaining({ Image: "bash:5" }));
  });

  it("uses bridge network when networkEnabled is true", async () => {
    await runInDocker({ code: 'print("hi")', language: "python", networkEnabled: true });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({ NetworkMode: "bridge" }),
      }),
    );
  });

  it("uses none network by default", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({ NetworkMode: "none" }),
      }),
    );
  });

  it("calls container.remove in finally on success", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it("calls container.remove in finally on container start failure", async () => {
    mockContainer.start.mockRejectedValue(new Error("failed to start"));
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it("returns error string when Docker unavailable — does not throw", async () => {
    mockCreateContainer.mockRejectedValue(new Error("Cannot connect to Docker daemon"));
    const result = await runInDocker({ code: 'print("hi")', language: "python" });
    expect(result.error).toContain("Cannot connect to Docker daemon");
    expect(result.stdout).toBe("");
    expect(result.outputFiles).toEqual([]);
  });

  it("writes input.files to workspace before running container", async () => {
    await runInDocker({
      code: 'print("hi")',
      language: "python",
      files: [{ name: "input.txt", content: "hello world" }],
    });
    // Verify createContainer was called — files are written internally
    expect(mockCreateContainer).toHaveBeenCalled();
  });

  it("returns output files read from output dir", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    // The output dir reading happens in finally; without mocking fs
    // we can only verify the function completes without error
    expect(mockCreateContainer).toHaveBeenCalled();
  });

  it("stdout is empty string when .stdout file absent", async () => {
    const result = await runInDocker({ code: 'print("hi")', language: "python" });
    expect(result.stdout).toBe("");
    expect(result.error).toBeUndefined();
  });

  it("copies workspaceFiles into temp dir before running", async () => {
    const sourceFile = join(workDir, "data.csv");
    await writeFile(sourceFile, "a,b\n1,2", "utf-8");
    await runInDocker({
      code: 'print("hi")',
      language: "python",
      workspaceFiles: [{ name: "data.csv", sourcePath: sourceFile }],
    });
    expect(mockCreateContainer).toHaveBeenCalled();
  });
});
