import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ipcMain, shell } from "electron";
import { z } from "zod/v4";
import { IPC } from "../../shared/ipc-channels";
import type { FileNode } from "../../shared/ipc-types";
import { PathJail } from "../agent/path-jail";
import { ProjectIdSchema, ReadArtifactFileSchema } from "../ipc-validation";
import { getResearchAssistantHome } from "../paths";
import type { AllowlistService } from "../services/AllowlistService";
import type { ArtifactService } from "../services/ArtifactService";
import type { ProjectService } from "../services/ProjectService";
import { parseOrThrow } from "./parse-util";

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".DS_Store",
  "coverage",
  ".next",
  "build",
  ".turbo",
  ".claude",
  ".vite",
  "out",
  "target",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".egg-info",
  ".tox",
  ".venv",
  "venv",
]);

const MAX_TREE_ENTRIES = 1000;
const MAX_TREE_DEPTH = 3;

export function registerArtifactHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    projectService: ProjectService;
    artifactService: ArtifactService;
    allowlistService: AllowlistService;
  },
): void {
  const { projectService, artifactService, allowlistService } = deps;

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_ARTIFACTS");
    return artifactService.listArtifacts(p.projectId);
  });

  ipcMain.handle(IPC.GET_FILE_TREE, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_FILE_TREE");

    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(p.projectId);
    } catch {
      throw new Error("Project not found");
    }

    const jail = new PathJail(project.id, project.folderPath, project.name, allowlistService);
    let count = 0;

    async function walk(dirPath: string, depth: number): Promise<FileNode[]> {
      if (depth >= MAX_TREE_DEPTH || count >= MAX_TREE_ENTRIES) return [];

      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch {
        return [];
      }

      const nodes: FileNode[] = [];
      for (const entry of entries) {
        if (count >= MAX_TREE_ENTRIES) break;
        if (IGNORED_NAMES.has(entry.name)) continue;
        if (
          entry.name.startsWith(".") &&
          !entry.name.startsWith(".research-assistant") &&
          !entry.name.startsWith(".agents")
        ) {
          continue;
        }

        const fullPath = join(dirPath, entry.name);
        try {
          jail.validate(fullPath, "read");
        } catch {
          continue;
        }

        count++;
        const node: FileNode = {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
        };

        if (entry.isDirectory() && depth < MAX_TREE_DEPTH - 1) {
          node.children = await walk(fullPath, depth + 1);
        }
        nodes.push(node);
      }
      return nodes;
    }

    const children: FileNode[] = [];

    if (project.folderPath) {
      try {
        const folderPath = jail.validate(project.folderPath, "read");
        const folderStats = await stat(folderPath);
        if (folderStats.isDirectory()) {
          children.push({
            name: "Project Folder",
            path: folderPath,
            isDirectory: true,
            children: await walk(folderPath, 0),
          });
        }
      } catch {
        // Folder not accessible
      }
    }

    try {
      const workspacePath = join(getResearchAssistantHome(), "workspace", project.id);
      const resolvedWorkspace = jail.validate(workspacePath, "read");
      const workspaceStats = await stat(resolvedWorkspace);
      if (workspaceStats.isDirectory()) {
        children.push({
          name: "Workspace",
          path: resolvedWorkspace,
          isDirectory: true,
          children: await walk(resolvedWorkspace, 0),
        });
      }
    } catch {
      // Workspace not accessible
    }

    return {
      name: project.name,
      path: project.folderPath || "",
      isDirectory: true,
      children,
    };
  });

  ipcMain.handle(IPC.READ_ARTIFACT_FILE, async (_event, payload: unknown) => {
    const { filePath, projectId } = parseOrThrow(
      ReadArtifactFileSchema,
      payload,
      "READ_ARTIFACT_FILE",
    );

    // Resolve project to get folder path for PathJail
    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(projectId);
    } catch {
      throw new Error("Project not found");
    }

    const jail = new PathJail(projectId, project.folderPath, project.name, allowlistService);

    // PathJail validates the path is within allowed zones
    const resolvedPath = jail.validate(filePath, "read");

    // Check file exists and get size
    let fileStats: import("node:fs").Stats;
    try {
      fileStats = await stat(resolvedPath);
    } catch {
      throw new Error("File not found");
    }

    // Check size before reading — reject files over 10MB
    if (fileStats.size > 10 * 1024 * 1024) {
      throw new Error("File too large to display (max 10MB)");
    }

    // Read with 500KB cap
    const content = await readFile(resolvedPath, { encoding: "utf-8" });
    if (content.length > 512_000) {
      return `${content.slice(0, 512_000)}\n\n<!-- Content truncated at 500KB -->`;
    }
    return content;
  });

  ipcMain.handle(IPC.GET_RECENT_OUTPUTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_RECENT_OUTPUTS");
    return artifactService.listUnacknowledged(p.projectId);
  });

  ipcMain.handle(IPC.ACKNOWLEDGE_OUTPUT, async (_event, payload: unknown) => {
    const { projectId, artifactId } = parseOrThrow(
      z.object({ projectId: z.string(), artifactId: z.string() }),
      payload,
      "ACKNOWLEDGE_OUTPUT",
    );
    await artifactService.acknowledge(projectId, artifactId);
  });

  ipcMain.handle(IPC.ACKNOWLEDGE_ALL_OUTPUTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "ACKNOWLEDGE_ALL_OUTPUTS");
    await artifactService.acknowledgeAll(p.projectId);
  });

  ipcMain.handle(IPC.REVEAL_IN_FOLDER, async (_event, payload: unknown) => {
    const { filePath, projectId } = parseOrThrow(
      z.object({ filePath: z.string(), projectId: z.string() }),
      payload,
      "REVEAL_IN_FOLDER",
    );

    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(projectId);
    } catch {
      throw new Error("Project not found");
    }

    const jail = new PathJail(projectId, project.folderPath, project.name, allowlistService);
    const resolvedPath = jail.validate(filePath, "read");

    shell.showItemInFolder(resolvedPath);
  });
}
