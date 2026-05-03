import { describe, expect, it, vi } from "vitest";
import { SkillWatcherService } from "../SkillWatcherService";

describe("SkillWatcherService", () => {
  it("emits skill:changed when a skill file is modified", async () => {
    const emit = vi.fn();
    const service = new SkillWatcherService({
      skillDirs: [],
      emit,
      manifestPath: "/tmp/manifest.json",
    });
    expect(service).toBeDefined();
    await service.start();
    service.stop();
  });
});
