// tests/eval/db-poller.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PollOptions {
  projectId: string;
  timeoutMs: number;
  pollIntervalMs?: number;
}

export interface PollResult {
  completed: boolean;
  taskId: string | null;
  durationMs: number;
  messages: unknown[];
  tasks: unknown[];
  artifacts: unknown[];
}

export async function pollForCompletion(
  options: PollOptions,
  deps: {
    getMessages: (projectId: string) => Promise<unknown[]>;
    getTasks: (projectId: string) => Promise<unknown[]>;
    getArtifacts: (projectId: string) => Promise<unknown[]>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<PollResult> {
  const { projectId, timeoutMs, pollIntervalMs = 2000 } = options;
  const start = deps.now();

  while (deps.now() - start < timeoutMs) {
    const [messages, tasks, artifacts] = await Promise.all([
      deps.getMessages(projectId),
      deps.getTasks(projectId),
      deps.getArtifacts(projectId),
    ]);

    const completedTask = tasks.find(
      (t: unknown) => (t as { status?: string }).status === "complete",
    );

    if (completedTask) {
      return {
        completed: true,
        taskId: (completedTask as { id: string }).id,
        durationMs: deps.now() - start,
        messages,
        tasks,
        artifacts,
      };
    }

    const failedTask = tasks.find(
      (t: unknown) => (t as { status?: string }).status === "failed",
    );

    if (failedTask) {
      return {
        completed: false,
        taskId: (failedTask as { id: string }).id,
        durationMs: deps.now() - start,
        messages,
        tasks,
        artifacts,
      };
    }

    await deps.sleep(pollIntervalMs);
  }

  return {
    completed: false,
    taskId: null,
    durationMs: deps.now() - start,
    messages: [],
    tasks: [],
    artifacts: [],
  };
}

export async function snapshotDbState(
  result: PollResult,
  outputDir: string,
): Promise<void> {
  const snapshot = {
    completed: result.completed,
    taskId: result.taskId,
    durationMs: result.durationMs,
    messages: result.messages,
    tasks: result.tasks,
    artifacts: result.artifacts,
  };
  await writeFile(join(outputDir, "db.json"), JSON.stringify(snapshot, null, 2), "utf-8");
}
