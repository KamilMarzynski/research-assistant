import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { injectable } from "tsyringe";

export interface ResearchCheckpoint {
  taskId: string;
  agentType: "researcher" | "orchestrator";
  researchOutput: string;
  messages: AgentMessage[];
  savedAt: string;
}

const CHECKPOINT_FILENAME = "checkpoint.json";

@injectable()
export class CheckpointService {
  async write(workspacePath: string, checkpoint: ResearchCheckpoint): Promise<void> {
    const path = join(workspacePath, CHECKPOINT_FILENAME);
    await writeFile(path, JSON.stringify(checkpoint, null, 2), "utf-8");
  }

  async read(workspacePath: string): Promise<ResearchCheckpoint | null> {
    const path = join(workspacePath, CHECKPOINT_FILENAME);
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as ResearchCheckpoint;
    } catch {
      return null;
    }
  }

  async delete(workspacePath: string): Promise<void> {
    const path = join(workspacePath, CHECKPOINT_FILENAME);
    try {
      await unlink(path);
    } catch {
      // No-op if file doesn't exist
    }
  }
}
