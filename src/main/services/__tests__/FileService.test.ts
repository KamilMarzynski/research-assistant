import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises");
vi.mock("node:fs");

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { FileService } from "../FileService";

describe("FileService", () => {
  let service: FileService;

  beforeEach(() => {
    service = new FileService();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readFile", () => {
    it("reads file content as utf-8 string", async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue("file content" as never);

      const result = await service.readFile("/some/path.md");

      expect(fsPromises.readFile).toHaveBeenCalledWith("/some/path.md", "utf-8");
      expect(result).toBe("file content");
    });
  });

  describe("writeFile", () => {
    it("writes content to path as utf-8", async () => {
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await service.writeFile("/some/path.md", "content here");

      expect(fsPromises.writeFile).toHaveBeenCalledWith("/some/path.md", "content here", "utf-8");
    });
  });

  describe("listFiles", () => {
    it("returns directory entries", async () => {
      vi.mocked(fsPromises.readdir).mockResolvedValue(["a.md", "b.md"] as never);

      const result = await service.listFiles("/some/dir");

      expect(fsPromises.readdir).toHaveBeenCalledWith("/some/dir");
      expect(result).toEqual(["a.md", "b.md"]);
    });
  });

  describe("watchDirectory", () => {
    it("returns an unsubscribe function that closes the watcher", () => {
      const mockClose = vi.fn();
      const mockWatcher = { close: mockClose } as unknown as fs.FSWatcher;
      vi.mocked(fs.watch).mockReturnValue(mockWatcher);

      const cb = vi.fn();
      const unsubscribe = service.watchDirectory("/some/dir", cb);

      expect(fs.watch).toHaveBeenCalledWith("/some/dir", { recursive: true }, cb);

      unsubscribe();
      expect(mockClose).toHaveBeenCalledOnce();
    });
  });
});
