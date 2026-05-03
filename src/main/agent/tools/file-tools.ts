import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PathJail } from "../path-jail";
import { makeTool } from "./make-tool";

export type SmartReadResult = {
  content: string;
  mimeType: string;
  truncated: boolean;
  hint: string;
  totalLines: number;
  lineCount: number;
  fileHash: string;
};

const MAX_BYTES = 500 * 1024;

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    js: "text/javascript",
    mjs: "text/javascript",
    cjs: "text/javascript",
    ts: "text/typescript",
    mts: "text/typescript",
    cts: "text/typescript",
    jsx: "text/jsx",
    tsx: "text/tsx",
    json: "application/json",
    md: "text/markdown",
    mdx: "text/markdown",
    txt: "text/plain",
    css: "text/css",
    html: "text/html",
    htm: "text/html",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    py: "text/x-python",
    pyc: "application/x-python-bytecode",
    pyo: "application/x-python-bytecode",
    pyd: "application/x-python-bytecode",
    java: "text/x-java",
    c: "text/x-c",
    cpp: "text/x-c++",
    cc: "text/x-c++",
    cxx: "text/x-c++",
    h: "text/x-c-header",
    hpp: "text/x-c++-header",
    hh: "text/x-c++-header",
    go: "text/x-go",
    rs: "text/x-rust",
    sh: "text/x-shellscript",
    bash: "text/x-shellscript",
    zsh: "text/x-shellscript",
    fish: "text/x-shellscript",
    sql: "text/x-sql",
    graphql: "text/x-graphql",
    gql: "text/x-graphql",
    svg: "image/svg+xml",
    csv: "text/csv",
    log: "text/plain",
    ini: "text/plain",
    toml: "text/plain",
    conf: "text/plain",
    config: "text/plain",
    cfg: "text/plain",
    lock: "text/plain",
    gitignore: "text/plain",
    env: "text/plain",
    dockerfile: "text/plain",
    vue: "text/x-vue",
    svelte: "text/x-svelte",
    astro: "text/x-astro",
    swift: "text/x-swift",
    kt: "text/x-kotlin",
    kts: "text/x-kotlin",
    scala: "text/x-scala",
    sc: "text/x-scala",
    rb: "text/x-ruby",
    erb: "text/x-ruby",
    php: "text/x-php",
    pl: "text/x-perl",
    pm: "text/x-perl",
    lua: "text/x-lua",
    r: "text/x-r",
    m: "text/x-objective-c",
    mm: "text/x-objective-c++",
    dart: "text/x-dart",
    elm: "text/x-elm",
    clj: "text/x-clojure",
    cljs: "text/x-clojure",
    edn: "application/edn",
    coffee: "text/coffeescript",
    litcoffee: "text/coffeescript",
    less: "text/css",
    scss: "text/css",
    sass: "text/css",
    styl: "text/css",
    stylus: "text/css",
    map: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
    ico: "image/x-icon",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    psd: "image/vnd.adobe.photoshop",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    flv: "video/x-flv",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    tgz: "application/gzip",
    bz2: "application/x-bzip2",
    xz: "application/x-xz",
    "7z": "application/x-7z-compressed",
    rar: "application/x-rar-compressed",
    epub: "application/epub+zip",
    rtf: "application/rtf",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    eot: "application/vnd.ms-fontobject",
    exe: "application/x-msdownload",
    dll: "application/x-msdownload",
    so: "application/x-sharedlib",
    dylib: "application/x-mach-binary",
    o: "application/x-object",
    a: "application/x-archive",
    obj: "application/x-object",
    bin: "application/octet-stream",
    dat: "application/octet-stream",
    db: "application/octet-stream",
    wasm: "application/wasm",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

function isBinaryMimeType(mime: string): boolean {
  if (mime.startsWith("text/")) return false;
  if (mime === "application/json") return false;
  if (mime === "application/xml") return false;
  if (mime === "application/yaml") return false;
  if (mime === "application/edn") return false;
  if (mime === "image/svg+xml") return false;
  return true;
}

export function createReadFileTool(
  jail: PathJail,
): AgentTool<typeof readFileParameters, SmartReadResult> {
  return makeTool({
    name: "read_file",
    label: "Read file",
    description:
      "Read the contents of a file with smart pagination and mime detection. Path must be within the workspace or linked project folder.",
    parameters: readFileParameters,
    execute: async (
      _id,
      { path, startLine, maxLines },
    ): Promise<AgentToolResult<SmartReadResult>> => {
      const resolved = jail.validate(path, "read");
      const buffer = await readFile(resolved);
      const fileHash = createHash("sha256").update(buffer).digest("hex");

      const ext = extname(resolved).slice(1);
      const mimeType = getMimeType(ext);

      if (isBinaryMimeType(mimeType)) {
        const placeholder = `[Binary file: ${resolved} (${mimeType})]`;
        return {
          content: [{ type: "text" as const, text: placeholder }],
          details: {
            content: placeholder,
            mimeType,
            truncated: false,
            hint: "Binary file detected. Use a specialized tool or download to view.",
            totalLines: 0,
            lineCount: 0,
            fileHash,
          },
        };
      }

      const fullText = buffer.toString("utf-8");
      const allLines =
        fullText === "" ? [] : fullText.split("\n").map((line) => line.replace(/\r$/, ""));
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      const totalLines = allLines.length;

      const sLine = Math.max(1, startLine ?? 1);
      const mLines = Math.max(1, maxLines ?? 500);
      const selectedLines = allLines.slice(sLine - 1, sLine - 1 + mLines);
      let content = selectedLines.join("\n");
      let truncated = false;
      let hint = "";

      const contentBuffer = Buffer.from(content, "utf-8");
      if (contentBuffer.length > MAX_BYTES) {
        content = contentBuffer.subarray(0, MAX_BYTES).toString("utf-8");
        truncated = true;
        const returnedLines = content === "" ? 0 : content.split("\n").length;
        hint = `Content truncated to 500KB. Use startLine=${sLine + returnedLines} to read later sections.`;
      } else if (totalLines > mLines) {
        hint = `Showing lines ${sLine}-${sLine + selectedLines.length - 1} of ${totalLines} total. Use startLine=${sLine + selectedLines.length} to read more.`;
      }

      const lineCount = content === "" ? 0 : content.split("\n").length;

      return {
        content: [{ type: "text" as const, text: content }],
        details: {
          content,
          mimeType,
          truncated,
          hint,
          totalLines,
          lineCount,
          fileHash,
        },
      };
    },
  });
}

const readFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  startLine: Type.Optional(Type.Number({ description: "Starting line (1-based)", default: 1 })),
  maxLines: Type.Optional(Type.Number({ description: "Maximum lines to return", default: 500 })),
});

export function createWriteFileTool(jail: PathJail): AgentTool<typeof writeFileParameters, null> {
  return makeTool({
    name: "write_file",
    label: "Write file",
    description:
      "Write content to a file, creating parent directories as needed. Path must be within the workspace or linked project folder.",
    parameters: writeFileParameters,
    execute: async (_id, { path, content }): Promise<AgentToolResult<null>> => {
      const resolved = jail.validate(path, "write");
      const dir = dirname(resolved);
      await mkdir(dir, { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        content: [{ type: "text" as const, text: `Written: ${resolved}` }],
        details: null,
      };
    },
  });
}

const writeFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  content: Type.String({ description: "Content to write" }),
});

export function createListDirTool(jail: PathJail): AgentTool<typeof listDirParameters, string[]> {
  return makeTool({
    name: "list_dir",
    label: "List directory",
    description:
      "List files and subdirectories in a directory. Path must be within the workspace or linked project folder.",
    parameters: listDirParameters,
    execute: async (_id, { path }): Promise<AgentToolResult<string[]>> => {
      const resolved = jail.validate(path, "read");
      const entries = await readdir(resolved, { withFileTypes: true });
      const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: entries.map((e) => e.name),
      };
    },
  });
}

const listDirParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the directory" }),
});
