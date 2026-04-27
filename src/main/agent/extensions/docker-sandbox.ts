import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Docker from "dockerode";

export interface DockerSandboxInput {
  code: string;
  language: "python" | "bash" | "typescript";
  files?: Array<{ name: string; content: string }>;
  networkEnabled?: boolean;
}

export interface DockerSandboxOutput {
  stdout: string;
  outputFiles: Array<{ name: string; content: string }>;
  error?: string;
}

const IMAGES: Record<DockerSandboxInput["language"], string> = {
  python: "python:3.11-slim",
  bash: "bash:5",
  typescript: "node:20-alpine",
};

const ENTRY_FILES: Record<DockerSandboxInput["language"], string> = {
  python: "main.py",
  bash: "main.sh",
  typescript: "main.ts",
};

// Redirect stdout+stderr to /workspace/.stdout so we can read it from the host mount.
// sh is available in all three base images.
const COMMANDS: Record<DockerSandboxInput["language"], string[]> = {
  python: ["sh", "-c", "python /workspace/main.py > /workspace/.stdout 2>&1"],
  bash: ["sh", "-c", "bash /workspace/main.sh > /workspace/.stdout 2>&1"],
  typescript: ["sh", "-c", "npx --yes tsx /workspace/main.ts > /workspace/.stdout 2>&1"],
};

const TIMEOUT_MS = 60_000;

export async function runInDocker(input: DockerSandboxInput): Promise<DockerSandboxOutput> {
  const docker = new Docker();
  let tmpDir: string | null = null;
  let container: Docker.Container | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "ra-docker-"));
    const outputDir = join(tmpDir, "output");
    await mkdir(outputDir, { recursive: true });

    for (const f of input.files ?? []) {
      await writeFile(join(tmpDir, f.name), f.content, "utf-8");
    }
    await writeFile(join(tmpDir, ENTRY_FILES[input.language]), input.code, "utf-8");

    container = await docker.createContainer({
      Image: IMAGES[input.language],
      Cmd: COMMANDS[input.language],
      Tty: false,
      HostConfig: {
        Binds: [`${tmpDir}:/workspace`],
        NetworkMode: input.networkEnabled ? "bridge" : "none",
      },
      WorkingDir: "/workspace",
    });

    await container.start();

    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      await (container as Docker.Container).stop({ t: 0 }).catch(() => {});
    }, TIMEOUT_MS);

    try {
      await container.wait();
    } finally {
      clearTimeout(timer);
    }

    // Read stdout from file written inside the container
    let stdout = "";
    try {
      stdout = await readFile(join(tmpDir, ".stdout"), "utf-8");
    } catch {
      // container may have failed before writing .stdout
    }

    const outputFiles: Array<{ name: string; content: string }> = [];
    try {
      const entries = await readdir(outputDir);
      for (const name of entries) {
        const content = await readFile(join(outputDir, name), "utf-8");
        outputFiles.push({ name, content });
      }
    } catch {
      // no output dir or empty
    }

    if (timedOut) {
      return { stdout, outputFiles, error: "Container timed out after 60s" };
    }

    return { stdout, outputFiles };
  } catch (err) {
    return {
      stdout: "",
      outputFiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (container) await container.remove({ force: true }).catch(() => {});
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
