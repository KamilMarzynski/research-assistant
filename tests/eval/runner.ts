// tests/eval/runner.ts
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchApp } from "../../e2e/helpers/electron";
import { cleanup } from "./cleanup";
import { pollForCompletion, snapshotDbState } from "./db-poller";
import { copyScholarConfig, createTempLocalProject } from "./fixture-loader";
import { runPromptfoo } from "./promptfoo";
import { generateReport } from "./report-generator";
import type { EvalOptions, EvalResult, RunId } from "./types";

const REPORTS_ROOT = join(process.cwd(), "tests", "eval", "reports");

export async function runEval(options: EvalOptions): Promise<EvalResult> {
  const runId: RunId = {
    timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
    fixture: options.fixture,
    id: `${new Date().toISOString().replace(/[:.]/g, "-")}-${options.fixture}`,
  };

  const reportDir = join(REPORTS_ROOT, runId.id);
  await mkdir(reportDir, { recursive: true });

  console.log(`[eval] Starting run: ${runId.id}`);

  // 1. Create temp local project
  const tempDir = await createTempLocalProject(options.fixture);
  console.log(`[eval] Temp project: ${tempDir}`);

  // 2. Launch app
  const app = await launchApp();
  const page = app.page;

  // 3. Create project via IPC
  const projectName = `eval-${options.fixture}`;
  const project = await page.evaluate(async (name) => {
    return await window.electronAPI.invoke("CREATE_PROJECT", { name });
  }, projectName);

  const projectId = project.id as string;
  console.log(`[eval] Created project: ${projectId}`);

  // 4. Link folder
  await page.evaluate(
    async ({ id, path }) => {
      return await window.electronAPI.invoke("LINK_PROJECT_FOLDER", {
        projectId: id,
        folderPath: path,
      });
    },
    { id: projectId, path: tempDir },
  );

  // 5. Copy scholar config
  const userDataPath = await app.app.evaluate(() => {
    const { app } = require("electron");
    return app.getPath("userData");
  });
  const scholarDir = join(userDataPath, ".scholar", "projects", projectId);
  await copyScholarConfig(options.fixture, scholarDir);

  // 6. Send research message
  await page.evaluate(
    async ({ id, content }) => {
      return await window.electronAPI.send("SEND_MESSAGE", { projectId: id, content });
    },
    {
      id: projectId,
      content: "Research whether solid-state batteries will reach commercial EV scale by 2030",
    },
  );

  // 7. Poll for completion
  const pollResult = await pollForCompletion(
    { projectId, timeoutMs: options.timeoutMs ?? 300000 },
    {
      getMessages: async (pid) => {
        return await page.evaluate(async (p) => {
          return await window.electronAPI.invoke("GET_MESSAGES", { projectId: p });
        }, pid);
      },
      getTasks: async (pid) => {
        // Tasks are not exposed via IPC — poll messages for research completion indicator
        const messages = await page.evaluate(async (p) => {
          return await window.electronAPI.invoke("GET_MESSAGES", { projectId: p });
        }, pid);
        const hasResearch = messages.some((m: Record<string, unknown>) =>
          String(m.content ?? "").includes("Research complete"),
        );
        return hasResearch ? [{ id: "research-1", status: "complete" }] : [];
      },
      getArtifacts: async (pid) => {
        return await page.evaluate(async (p) => {
          return await window.electronAPI.invoke("GET_ARTIFACTS", { projectId: p });
        }, pid);
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
  );

  // 8. Snapshot DB state
  await mkdir(join(reportDir, "03-db-dump"), { recursive: true });
  await snapshotDbState(pollResult, join(reportDir, "03-db-dump"));

  // 9. Snapshot artifacts
  await mkdir(join(reportDir, "04-artifacts"), { recursive: true });
  if (pollResult.artifacts.length > 0) {
    for (const artifact of pollResult.artifacts as { path: string }[]) {
      if (artifact.path) {
        await cp(artifact.path, join(reportDir, "04-artifacts"), { force: true });
      }
    }
  }

  // 10. Run Promptfoo
  const artifactPath =
    pollResult.artifacts.length > 0 ? (pollResult.artifacts[0] as { path: string }).path : "";

  let promptfooResult = {
    passed: false,
    tier1Pass: 0,
    tier1Total: 0,
    tier2Pass: 0,
    tier2Total: 0,
    tier3Score: 0,
    tier3Reasoning: "No artifact found",
    raw: null,
  };

  if (artifactPath) {
    promptfooResult = await runPromptfoo(
      artifactPath,
      join(process.cwd(), "tests", "eval", "promptfooconfig.yaml"),
      options.judgeModel,
    );
  }

  // 11. Build result
  const result: EvalResult = {
    runId: runId.id,
    completed: pollResult.completed,
    durationMs: pollResult.durationMs,
    artifactCount: pollResult.artifacts.length,
    tier1Pass: promptfooResult.tier1Pass,
    tier1Total: promptfooResult.tier1Total,
    tier2Pass: promptfooResult.tier2Pass,
    tier2Total: promptfooResult.tier2Total,
    tier3Score: promptfooResult.tier3Score,
    tier3Reasoning: promptfooResult.tier3Reasoning,
  };

  // 12. Copy fixture snapshot
  await mkdir(join(reportDir, "00-fixture"), { recursive: true });
  await cp(
    join(process.cwd(), "tests", "eval", "fixtures", options.fixture),
    join(reportDir, "00-fixture"),
    { recursive: true },
  );

  await mkdir(join(reportDir, "01-local-project"), { recursive: true });
  await cp(tempDir, join(reportDir, "01-local-project"), { recursive: true });

  await mkdir(join(reportDir, "02-scholar"), { recursive: true });
  await cp(scholarDir, join(reportDir, "02-scholar"), { recursive: true });

  // 13. Generate report
  await generateReport(runId, result, reportDir);

  // 14. Cleanup
  await cleanup(
    { keep: options.keep ?? false, tempDir, scholarDir, projectId },
    {
      deleteProject: async (id) => {
        await page.evaluate(async (pid) => {
          return await window.electronAPI.invoke("DELETE_PROJECT", { projectId: pid });
        }, id);
      },
    },
  );

  await app.app.close();

  console.log(`[eval] Run complete: ${runId.id}`);
  return result;
}
