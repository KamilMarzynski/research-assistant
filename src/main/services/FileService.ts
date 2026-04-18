import { watch } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { injectable } from "tsyringe";

@injectable()
export class FileService {
  async readFile(filePath: string): Promise<string> {
    return readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, "utf-8");
  }

  async listFiles(dir: string): Promise<string[]> {
    return readdir(dir);
  }

  watchDirectory(dir: string, cb: (event: string, filename: string | null) => void): () => void {
    const watcher = watch(dir, { recursive: true }, cb);
    return () => watcher.close();
  }
}
