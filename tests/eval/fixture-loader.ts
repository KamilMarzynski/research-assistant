// tests/eval/fixture-loader.ts
import { cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FixturePaths } from "./types";

const FIXTURES_ROOT = join(process.cwd(), "tests", "eval", "fixtures");

export function resolveFixtureDir(fixtureName: string): string {
  return join(FIXTURES_ROOT, fixtureName);
}

export async function createTempLocalProject(fixtureName: string): Promise<string> {
  const fixtureDir = resolveFixtureDir(fixtureName);
  const localSource = join(fixtureDir, "local-project");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempDir = join(tmpdir(), `scholar-eval-${fixtureName}-${timestamp}`);

  await mkdir(tempDir, { recursive: true });
  await cp(localSource, tempDir, { recursive: true, force: true });

  return tempDir;
}

export async function copyScholarConfig(
  fixtureName: string,
  scholarTargetDir: string,
): Promise<void> {
  const fixtureDir = resolveFixtureDir(fixtureName);
  const scholarSource = join(fixtureDir, "scholar");

  await mkdir(scholarTargetDir, { recursive: true });
  await cp(scholarSource, scholarTargetDir, { recursive: true, force: true });
}

export function getFixturePaths(fixtureName: string): FixturePaths {
  const fixtureDir = resolveFixtureDir(fixtureName);
  return {
    fixtureDir,
    localProjectDir: join(fixtureDir, "local-project"),
    scholarDir: join(fixtureDir, "scholar"),
  };
}
