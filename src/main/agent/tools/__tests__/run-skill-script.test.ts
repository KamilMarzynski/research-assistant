import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunSkillScriptTool } from "../run-skill-script-tool";

let tmpHome: string;
let auditLog: string;

beforeEach(async () => {
  tmpHome = join(tmpdir(), `rss-test-${Date.now()}`);
  await mkdir(tmpHome, { recursive: true });
  auditLog = join(tmpHome, "audit.log");
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
});

async function makeGlobalSkillScript(skillName: string, content: string): Promise<void> {
  const dir = join(tmpHome, "skills", skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "script.sh"), content, "utf-8");
}

async function makeProjectSkillScript(
  slug: string,
  skillName: string,
  content: string,
): Promise<void> {
  const dir = join(tmpHome, "projects", slug, "skills", skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "script.sh"), content, "utf-8");
}

describe("run_skill_script tool", () => {
  it("runs a global skill script and returns stdout", async () => {
    await makeGlobalSkillScript("say-hello", "#!/bin/bash\necho 'hello from skill'");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-1", {
      skillName: "say-hello",
      scope: "global",
      intent: "test",
    });
    expect((result.content[0] as { text: string }).text).toContain("hello from skill");
  });

  it("runs a project-scoped skill script", async () => {
    await makeProjectSkillScript("my-slug", "proj-skill", "#!/bin/bash\necho 'project skill'");
    const tool = createRunSkillScriptTool("my-slug", tmpHome, auditLog);
    const result = await tool.execute("call-2", {
      skillName: "proj-skill",
      scope: "project",
      intent: "test",
    });
    expect((result.content[0] as { text: string }).text).toContain("project skill");
  });

  it("returns error message when script does not exist", async () => {
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-3", {
      skillName: "nonexistent",
      scope: "global",
      intent: "test",
    });
    expect((result.content[0] as { text: string }).text).toContain("No script found");
    expect(result.details.exitCode).toBe(1);
  });

  it("reports non-zero exit code", async () => {
    await makeGlobalSkillScript("fail-skill", "#!/bin/bash\nexit 42");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-4", {
      skillName: "fail-skill",
      scope: "global",
      intent: "test",
    });
    expect(result.details.exitCode).toBe(42);
  });

  it("passes args to the script", async () => {
    await makeGlobalSkillScript("echo-args", '#!/bin/bash\necho "arg: $1"');
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-5", {
      skillName: "echo-args",
      scope: "global",
      intent: "test",
      args: ["hello"],
    });
    expect((result.content[0] as { text: string }).text).toContain("arg: hello");
  });

  it("writes an audit log entry", async () => {
    await makeGlobalSkillScript("audit-skill", "#!/bin/bash\necho done");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    await tool.execute("call-6", {
      skillName: "audit-skill",
      scope: "global",
      intent: "audit test",
    });
    const { readFile } = await import("node:fs/promises");
    const log = await readFile(auditLog, "utf-8");
    const entry = JSON.parse(log.trim());
    expect(entry.type).toBe("skill_script");
    expect(entry.intent).toBe("audit test");
  });
});
