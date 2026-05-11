// tests/eval/fixture-loader.test.ts
import { describe, expect, it } from "vitest";
import { createTempLocalProject, getFixturePaths, resolveFixtureDir } from "./fixture-loader";

describe("fixture-loader", () => {
  it("resolves fixture directory", () => {
    const dir = resolveFixtureDir("solid-state-batteries");
    expect(dir).toContain("tests/eval/fixtures/solid-state-batteries");
  });

  it("returns fixture paths", () => {
    const paths = getFixturePaths("solid-state-batteries");
    expect(paths.localProjectDir).toContain("local-project");
    expect(paths.scholarDir).toContain("scholar");
  });

  it("creates temp local project", async () => {
    const tempDir = await createTempLocalProject("solid-state-batteries");
    expect(tempDir).toContain("scholar-eval-solid-state-batteries");
  });
});
