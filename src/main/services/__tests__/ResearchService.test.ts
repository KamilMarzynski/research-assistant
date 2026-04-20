import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { NotImplementedError } from "../errors";
import { ResearchService } from "../ResearchService";

describe("ResearchService", () => {
  describe("startResearch", () => {
    it("throws NotImplementedError (wired in Run 6)", async () => {
      const service = new ResearchService();

      await expect(
        service.startResearch("proj-1", "Project 1", "quantum computing", null),
      ).rejects.toThrow(NotImplementedError);
      await expect(
        service.startResearch("proj-1", "Project 1", "quantum computing", null),
      ).rejects.toThrow("Run 6");
    });
  });
});
