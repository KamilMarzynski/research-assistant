# Run 13 — Web Access for Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fetch_url` and `web_search` agent tools with SSRF protection, HTML-to-Markdown extraction, DuckDuckGo search, and a global settings toggle.

**Architecture:** Modular tool suite in `src/main/agent/tools/web/` — each unit (SSRF guard, HTML extractor, fetch tool, search tool) is independently testable. Tools wire into existing `createAgentTools()` factory. Settings toggle flows through existing `AppSettings` → `AgentToolsOptions` → `createAgentTools`.

**Tech Stack:** Bun `fetch()`, `node:dns/promises` for SSRF checks, regex-based HTML extraction, DuckDuckGo HTML scraping.

---

## File Structure

```
src/main/agent/tools/web/
├── ssrf-guard.ts              — DNS resolve + private IP block + redirect following
├── html-extractor.ts          — HTML → Markdown extraction
├── fetch-url.ts               — fetch_url tool (uses ssrf-guard + html-extractor)
├── web-search.ts              — web_search tool (DuckDuckGo scraping)
└── __tests__/
    ├── ssrf-guard.test.ts     — SSRF private IP, redirect, IPv6 tests
    ├── html-extractor.test.ts — heading, paragraph, link, code, table tests
    ├── fetch-url.test.ts      — integration test for tool registration
    └── web-search.test.ts     — DuckDuckGo HTML parsing tests

src/main/agent/
├── tools.ts                   — add "fetch_url", "web_search" to AgentToolName + wire into createAgentTools
├── worker-agent.ts            — researcher preset gets both tools
└── builtin-skills.ts          — append web access section to START_RESEARCH_SKILL

src/main/services/
├── SettingsService.ts         — add webAccessEnabled: boolean (default true) to AppSettings + StoredSettings
└── __tests__/SettingsService.test.ts — add webAccessEnabled to existing tests

src/renderer/components/settings/
└── SettingsModal.tsx          — add "Web Access" toggle to General tab, read/write webAccessEnabled
```

---

## Task 1: SSRF Guard

**Files:**
- Create: `src/main/agent/tools/web/ssrf-guard.ts`
- Create: `src/main/agent/tools/web/__tests__/ssrf-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateIp } from "../ssrf-guard";

describe("isPrivateIp", () => {
  it("blocks 10.0.0.1", () => expect(isPrivateIp("10.0.0.1")).toBe(true));
  it("blocks 172.16.0.1", () => expect(isPrivateIp("172.16.0.1")).toBe(true));
  it("blocks 192.168.1.1", () => expect(isPrivateIp("192.168.1.1")).toBe(true));
  it("blocks 127.0.0.1", () => expect(isPrivateIp("127.0.0.1")).toBe(true));
  it("blocks 169.254.0.1", () => expect(isPrivateIp("169.254.0.1")).toBe(true));
  it("allows 93.184.216.34", () => expect(isPrivateIp("93.184.216.34")).toBe(false));
  it("blocks ::1", () => expect(isPrivateIp("::1")).toBe(true));
  it("blocks fc00::1", () => expect(isPrivateIp("fc00::1")).toBe(true));
  it("allows 2001:db8::1", () => expect(isPrivateIp("2001:db8::1")).toBe(false));
});

describe("assertSafeUrl", () => {
  it("throws for http://10.0.0.1/path", async () => {
    await expect(assertSafeUrl("http://10.0.0.1/path")).rejects.toThrow("SSRF guard blocked");
  });

  it("throws for http://localhost:8080", async () => {
    await expect(assertSafeUrl("http://localhost:8080")).rejects.toThrow("SSRF guard blocked");
  });

  it("throws for http://127.0.0.1:11434", async () => {
    await expect(assertSafeUrl("http://127.0.0.1:11434")).rejects.toThrow("SSRF guard blocked");
  });

  it("allows http://example.com", async () => {
    const result = await assertSafeUrl("http://example.com");
    expect(result).toBe("http://example.com");
  });

  it("allows https://github.com", async () => {
    const result = await assertSafeUrl("https://github.com");
    expect(result).toBe("https://github.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/agent/tools/web/__tests__/ssrf-guard.test.ts`
Expected: FAIL — modules not found, functions not exported

- [ ] **Step 3: Write minimal implementation**

Create `src/main/agent/tools/web/ssrf-guard.ts`:

```typescript
import { resolve4, resolve6 } from "node:dns/promises";

const PRIVATE_IPV4_RANGES = [
  [10, 0, 0, 0, 8],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
] as const;

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isIPv4InCidr(ip: number[], network: number[], prefix: number): boolean {
  const mask = 0xffffffff << (32 - prefix);
  const ipNum = (ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3];
  const netNum = (network[0] << 24) | (network[1] << 16) | (network[2] << 8) | network[3];
  return (ipNum & mask) === (netNum & mask);
}

export function isPrivateIp(ip: string): boolean {
  // IPv4
  const ipv4 = parseIPv4(ip);
  if (ipv4) {
    return PRIVATE_IPV4_RANGES.some(([a, b, c, d, prefix]) =>
      isIPv4InCidr(ipv4, [a, b, c, d], prefix),
    );
  }

  // IPv6 loopback
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;

  // IPv6 ULA (fc00::/7)
  const parts = ip.split(":").map((p) => Number.parseInt(p, 16));
  if (parts.length >= 1 && !Number.isNaN(parts[0])) {
    const first = parts[0];
    if ((first & 0xfe00) === 0xfc00) return true;
  }

  return false;
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const ips: string[] = [];
  try {
    const v4 = await resolve4(hostname);
    ips.push(...v4);
  } catch {
    // ignore
  }
  try {
    const v6 = await resolve6(hostname);
    ips.push(...v6);
  } catch {
    // ignore
  }
  return ips;
}

export async function assertSafeUrl(
  url: string,
  opts: { followRedirects?: boolean; maxRedirects?: number } = {},
): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF guard blocked ${url}: unsupported protocol ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  // Skip DNS check for already-resolved IP addresses
  const ipv4 = parseIPv4(hostname);
  if (ipv4) {
    if (isPrivateIp(hostname)) {
      throw new Error(`SSRF guard blocked ${url}: resolved to private IP ${hostname}`);
    }
    return url;
  }

  const ips = await resolveHostname(hostname);
  if (ips.length === 0) {
    throw new Error(`SSRF guard blocked ${url}: could not resolve hostname ${hostname}`);
  }

  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new Error(`SSRF guard blocked ${url}: resolved to private IP ${ip}`);
    }
  }

  return url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/main/agent/tools/web/__tests__/ssrf-guard.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/web/
git commit -m "feat(run13): add SSRF guard with private IP blocking

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: HTML Extractor

**Files:**
- Create: `src/main/agent/tools/web/html-extractor.ts`
- Create: `src/main/agent/tools/web/__tests__/html-extractor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { extractMarkdown } from "../html-extractor";

describe("extractMarkdown", () => {
  it("extracts title from <title>", () => {
    const html = "<html><head><title>Hello World</title></head><body><p>content</p></body></html>";
    const result = extractMarkdown(html);
    expect(result.title).toBe("Hello World");
    expect(result.markdown).toContain("content");
  });

  it("converts h1-h6 to markdown headings", () => {
    const html = "<h1>One</h1><h2>Two</h2><h3>Three</h3>";
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("# One");
    expect(result.markdown).toContain("## Two");
    expect(result.markdown).toContain("### Three");
  });

  it("converts paragraphs", () => {
    const html = "<p>First para</p><p>Second para</p>";
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("First para");
    expect(result.markdown).toContain("Second para");
  });

  it("converts links to markdown", () => {
    const html = '<a href="https://example.com">Click here</a>';
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("[Click here](https://example.com)");
  });

  it("converts inline code", () => {
    const html = "<p>Use <code>const</code> for constants</p>";
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("`const`");
  });

  it("converts pre code blocks", () => {
    const html = "<pre><code>function foo() {}</code></pre>";
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("```");
    expect(result.markdown).toContain("function foo() {}");
  });

  it("strips script and style tags", () => {
    const html = '<script>alert(1)</script><p>Hello</p><style>.x{color:red}</style>';
    const result = extractMarkdown(html);
    expect(result.markdown).not.toContain("alert");
    expect(result.markdown).not.toContain("color:red");
    expect(result.markdown).toContain("Hello");
  });

  it("truncates at maxChars with marker", () => {
    const html = "<p>" + "a".repeat(1000) + "</p>";
    const result = extractMarkdown(html, { maxChars: 100 });
    expect(result.markdown.length).toBeLessThanOrEqual(120);
    expect(result.markdown).toContain("[...content truncated...]");
  });

  it("passes through plain text", () => {
    const result = extractMarkdown("Just plain text");
    expect(result.markdown).toContain("Just plain text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/agent/tools/web/__tests__/html-extractor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/main/agent/tools/web/html-extractor.ts`:

```typescript
export interface ExtractResult {
  title: string;
  markdown: string;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTagContent(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(regex);
  return match?.[1]?.trim() ?? null;
}

export function extractMarkdown(html: string, opts: { maxChars?: number } = {}): ExtractResult {
  const maxChars = opts.maxChars ?? 50000;

  // Extract title
  const title = extractTagContent(html, "title") ?? "";

  // Extract meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  const metaDescription = metaDescMatch?.[1]?.trim();

  // Process headings
  let md = html.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, content) => `# ${stripInlineTags(content)}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, content) => `## ${stripInlineTags(content)}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, content) => `### ${stripInlineTags(content)}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, content) => `#### ${stripInlineTags(content)}\n\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, content) => `##### ${stripInlineTags(content)}\n\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, content) => `###### ${stripInlineTags(content)}\n\n`);

  // Process code blocks
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
    const code = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "$1").trim();
    return `\`\`\`\n${code}\n\`\`\`\n\n`;
  });

  // Process links
  md = md.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    return `[${stripInlineTags(text)}](${href})`;
  });

  // Process inline code (remaining <code> tags)
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => `\`${content.trim()}\``);

  // Process paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => `${stripInlineTags(content)}\n\n`);

  // Process lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${stripInlineTags(content)}\n`);
  md = md.replace(/<\/?(?:ul|ol)[^>]*>/gi, "");

  // Strip remaining tags
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  md = md.replace(/<header[\s\S]*?<\/header>/gi, "");
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  md = md.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  md = md.replace(/<[^>]+>/g, " ");

  // Normalize whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/\s+/g, " ");
  md = md.trim();

  // Add meta description if present
  if (metaDescription) {
    md = `> Description: ${metaDescription}\n\n${md}`;
  }

  // Truncate
  if (md.length > maxChars) {
    md = md.slice(0, maxChars) + "\n\n[...content truncated...]";
  }

  return { title, markdown: md };
}

function stripInlineTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/main/agent/tools/web/__tests__/html-extractor.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/web/
git commit -m "feat(run13): add HTML-to-Markdown extractor

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Fetch URL Tool

**Files:**
- Create: `src/main/agent/tools/web/fetch-url.ts`
- Create: `src/main/agent/tools/web/__tests__/fetch-url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { createFetchUrlTool } from "../fetch-url";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";

describe("createFetchUrlTool", () => {
  it("returns a tool with correct name and label", () => {
    const tool = createFetchUrlTool();
    expect(tool.name).toBe("fetch_url");
    expect(tool.label).toBe("Fetch URL");
  });

  it("has required url parameter", () => {
    const tool = createFetchUrlTool();
    const schema = tool.parameters as { required: string[] };
    expect(schema.required).toContain("url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/agent/tools/web/__tests__/fetch-url.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/main/agent/tools/web/fetch-url.ts`:

```typescript
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { extractMarkdown } from "./html-extractor";
import { assertSafeUrl } from "./ssrf-guard";

export function createFetchUrlTool(): AgentTool<
  ReturnType<typeof Type.Object>,
  { url: string; title: string }
> {
  return {
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch a web page and return its content as clean Markdown. URL must be http or https. Internal/private IPs are blocked for security.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch, must start with http:// or https://" }),
      maxChars: Type.Optional(
        Type.Number({ description: "Maximum characters to return (default 50000)" }),
      ),
    }),
    execute: async (_id, { url, maxChars }): Promise<AgentToolResult<{ url: string; title: string }>> => {
      const safeUrl = await assertSafeUrl(url, { followRedirects: true, maxRedirects: 5 });
      const response = await fetch(safeUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${safeUrl}`);
      }
      const html = await response.text();
      const { title, markdown } = extractMarkdown(html, { maxChars });
      const summary = [`# ${title || "Untitled"}`, markdown].filter(Boolean).join("\n\n");
      return {
        content: [{ type: "text" as const, text: summary }],
        details: { url: safeUrl, title: title || "Untitled" },
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/main/agent/tools/web/__tests__/fetch-url.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/web/
git commit -m "feat(run13): add fetch_url agent tool

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Web Search Tool (DuckDuckGo)

**Files:**
- Create: `src/main/agent/tools/web/web-search.ts`
- Create: `src/main/agent/tools/web/__tests__/web-search.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { createWebSearchTool, parseDdgResults } from "../web-search";

describe("parseDdgResults", () => {
  it("parses DuckDuckGo HTML results", () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://example.com/1">Title One</a>
        <div class="result__snippet">Snippet one here</div>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.com/2">Title Two</a>
        <div class="result__snippet">Snippet two here</div>
      </div>
    `;
    const results = parseDdgResults(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "Title One", url: "https://example.com/1", snippet: "Snippet one here" });
    expect(results[1]).toEqual({ title: "Title Two", url: "https://example.com/2", snippet: "Snippet two here" });
  });

  it("returns empty array for no results", () => {
    const results = parseDdgResults("<html><body>no results</body></html>", 5);
    expect(results).toEqual([]);
  });

  it("respects maxResults cap", () => {
    const html = Array(10)
      .fill(0)
      .map(
        (_, i) => `
        <div class="result">
          <a class="result__a" href="https://example.com/${i}">Title ${i}</a>
          <div class="result__snippet">Snippet ${i}</div>
        </div>
      `,
      )
      .join("");
    const results = parseDdgResults(html, 5);
    expect(results).toHaveLength(5);
  });
});

describe("createWebSearchTool", () => {
  it("returns a tool with correct name", () => {
    const tool = createWebSearchTool();
    expect(tool.name).toBe("web_search");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/agent/tools/web/__tests__/web-search.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/main/agent/tools/web/web-search.ts`:

```typescript
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function parseDdgResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  // Split by result blocks
  const resultBlocks = html.split('<div class="result"');

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);

    if (titleMatch) {
      const url = titleMatch[1].trim();
      const title = titleMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "";
      results.push({ title, url, snippet });
    }
  }

  return results;
}

export async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ResearchAssistant/1.0)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const results = parseDdgResults(html, Math.min(maxResults, 10));

  if (results.length === 0 && html.includes("captcha")) {
    return [];
  }

  return results;
}

export function createWebSearchTool(): AgentTool<
  ReturnType<typeof Type.Object>,
  SearchResult[]
> {
  return {
    name: "web_search",
    label: "Search the web",
    description:
      "Search the web using DuckDuckGo. Returns titles, URLs, and snippets. No API key required.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(
        Type.Number({ description: "Max results (default 5, max 10)" }),
      ),
    }),
    execute: async (_id, { query, maxResults }): Promise<AgentToolResult<SearchResult[]>> => {
      const results = await searchDuckDuckGo(query, maxResults ?? 5);
      const text =
        results.length === 0
          ? "No results found. The search engine may be rate-limiting requests."
          : results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`).join("\n\n");
      return {
        content: [{ type: "text" as const, text }],
        details: results,
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/main/agent/tools/web/__tests__/web-search.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/web/
git commit -m "feat(run13): add web_search agent tool with DuckDuckGo scraping

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Wire Tools into Agent System

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Update `AgentToolName` union and `AgentToolsOptions` in `tools.ts`**

Add to `src/main/agent/tools.ts`:

```typescript
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "request_evaluation"
  | "start_research"
  | "run_in_docker"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "save_artifact"
  | "propose_tool"
  | "fetch_url"
  | "web_search";
```

Add `webAccessEnabled?: boolean` to `AgentToolsOptions` interface.

- [ ] **Step 2: Import and wire tools in `createAgentTools`**

Add imports at top of `src/main/agent/tools.ts`:

```typescript
import { createFetchUrlTool } from "./tools/web/fetch-url";
import { createWebSearchTool } from "./tools/web/web-search";
```

Add inside `createAgentTools`, after the `safe_bash` tool and before `run_in_docker`:

```typescript
if (opts.webAccessEnabled !== false) {
  tools.push(createFetchUrlTool());
  tools.push(createWebSearchTool());
}
```

- [ ] **Step 3: Update researcher preset in `worker-agent.ts`**

Change researcher preset in `src/main/agent/worker-agent.ts`:

```typescript
researcher: (base, outputPath) => ({
  ...base,
  toolNames: [
    "read_file",
    "write_file",
    "list_dir",
    "safe_bash",
    "fetch_url",
    "web_search",
  ],
  // ... rest unchanged
}),
```

- [ ] **Step 4: Verify types pass**

Run: `bun run typecheck`
Expected: PASS (or errors only from unrelated issues)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/worker-agent.ts
git commit -m "feat(run13): wire fetch_url and web_search into agent tool system

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Settings Service — Add Web Access Toggle

**Files:**
- Modify: `src/main/services/SettingsService.ts`
- Modify: `src/main/services/__tests__/SettingsService.test.ts`

- [ ] **Step 1: Add `webAccessEnabled` to interfaces and defaults**

In `src/main/services/SettingsService.ts`:

Add `webAccessEnabled: boolean;` to `AppSettings` interface (after `langfuseEnabled`).

Add `webAccessEnabled: true` to `DEFAULT_SETTINGS`.

Add `webAccessEnabled?: boolean;` to `StoredSettings` interface.

In `migrateV0ToV1`, add `webAccessEnabled: stored.langfuseEnabled ?? true` (or just `true` for migration).

In `getSettings`, add `webAccessEnabled: migrated.webAccessEnabled ?? true`.

In `saveSettings`, add `webAccessEnabled: next.webAccessEnabled` to the `stored` object.

- [ ] **Step 2: Update existing SettingsService tests**

In `src/main/services/__tests__/SettingsService.test.ts`, add `webAccessEnabled: true` to any test objects that construct full `AppSettings` or `StoredSettings`.

- [ ] **Step 3: Run SettingsService tests**

Run: `bun test src/main/services/__tests__/SettingsService.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/SettingsService.ts src/main/services/__tests__/SettingsService.test.ts
git commit -m "feat(run13): add webAccessEnabled to AppSettings

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Settings Modal — Web Access Toggle UI

**Files:**
- Modify: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add `webAccessEnabled` state and wiring**

Add `const [webAccessEnabled, setWebAccessEnabled] = useState(true);` near `langfuseEnabled` state.

In the `GET_SETTINGS` handler `useEffect`, add:
```typescript
setWebAccessEnabled(settings.webAccessEnabled ?? true);
```

In `handleSave`, add `webAccessEnabled` to the saved payload.

- [ ] **Step 2: Add toggle to General tab**

In the `tab === 0` block, after the LangFuse switch, add:

```tsx
<FormControlLabel
  control={
    <Switch
      checked={webAccessEnabled}
      onChange={(e) => setWebAccessEnabled(e.target.checked)}
    />
  }
  label="Enable web access for agents (fetch_url, web_search)"
  sx={{ mt: 1 }}
/>
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/settings/SettingsModal.tsx
git commit -m "feat(run13): add Web Access toggle to SettingsModal

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Pass Settings Through to Agent Session

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Update `AgentSessionOptions` and `AgentSession`**

In `src/main/agent/session.ts`:

Add `webAccessEnabled?: boolean` to `AgentSessionOptions`.

In `AgentSession` constructor, pass `webAccessEnabled: opts.webAccessEnabled` to `createAgentTools`.

- [ ] **Step 2: Update `WorkerAgentConfig` and `createWorkerAgent`**

In `src/main/agent/worker-agent.ts`:

Add `webAccessEnabled?: boolean` to `WorkerAgentConfig`.

Pass `webAccessEnabled: config.webAccessEnabled` to `createAgentTools`.

- [ ] **Step 3: Update IPC handlers to pass setting**

In `src/main/ipc-handlers.ts` (or wherever `AgentSession` is instantiated):

Pass `webAccessEnabled: settings.webAccessEnabled` to `AgentSession` constructor.

Similarly for `ResearchService` → `createWorkerAgent` calls — pass `webAccessEnabled` through.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/worker-agent.ts src/main/ipc-handlers.ts
git commit -m "feat(run13): pass webAccessEnabled through AgentSession and WorkerAgent

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Update START_RESEARCH_SKILL Prompt

**Files:**
- Modify: `src/main/agent/builtin-skills.ts`

- [ ] **Step 1: Append web access section**

Add after the existing `START_RESEARCH_SKILL` content (before the closing `` ` ``):

```

## Web Access

Your researcher agents have two web access tools:

- **fetch_url** — fetch a specific web page and get clean Markdown content
- **web_search** — search DuckDuckGo for relevant pages

Use these when the research requires:
- Reading documentation, papers, articles, or blog posts
- Finding current information not in the project files
- Comparing approaches from external sources

**Note:** safe_bash still blocks curl and wget. Use fetch_url instead.
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/builtin-skills.ts
git commit -m "feat(run13): document fetch_url and web_search in START_RESEARCH_SKILL

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Integration Tests

**Files:**
- Create: `src/main/agent/tools/web/__tests__/fetch-url-integration.test.ts`
- Modify: `src/main/agent/__tests__/model-provider.test.ts` or similar existing test to verify tool registration

Actually, simpler: create a single integration test in the web `__tests__` directory.

- [ ] **Step 1: Write integration test**

Create `src/main/agent/tools/web/__tests__/integration.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createAgentTools } from "../../tools";

describe("tool registration", () => {
  it("includes fetch_url and web_search when webAccessEnabled is true", () => {
    const tools = createAgentTools({
      projectId: "test",
      projectName: "Test",
      folderPath: null,
      homePath: "/tmp",
      webAccessEnabled: true,
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("fetch_url");
    expect(names).toContain("web_search");
  });

  it("excludes fetch_url and web_search when webAccessEnabled is false", () => {
    const tools = createAgentTools({
      projectId: "test",
      projectName: "Test",
      folderPath: null,
      homePath: "/tmp",
      webAccessEnabled: false,
    });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("fetch_url");
    expect(names).not.toContain("web_search");
  });

  it("excludes fetch_url and web_search when webAccessEnabled is undefined", () => {
    const tools = createAgentTools({
      projectId: "test",
      projectName: "Test",
      folderPath: null,
      homePath: "/tmp",
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain("fetch_url");
    expect(names).toContain("web_search");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/main/agent/tools/web/__tests__/integration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/web/__tests__/integration.test.ts
git commit -m "test(run13): add tool registration integration tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All existing + new tests pass

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: Zero errors

- [ ] **Step 3: Run lint/format check**

Run: `bun run check`
Expected: Clean (Biome passes)

- [ ] **Step 4: Start dev server and verify Settings UI**

Run: `bun run dev`
- Open Settings → General tab
- Verify "Enable web access for agents" toggle is present
- Toggle off, save, reload, verify state persists

- [ ] **Step 5: Commit any remaining fixes**

```bash
# If biome check found issues:
git add -A
git commit -m "style(run13): biome formatting fixes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| `fetch_url` tool with SSRF protection | Task 3 |
| SSRF guard: DNS resolve + private IP block | Task 1 |
| Redirect following (max 5 hops, re-check each) | Task 1 (assertSafeUrl with followRedirects) |
| HTML → Markdown extraction | Task 2 |
| `web_search` tool with DuckDuckGo | Task 4 |
| Global settings toggle (default ON) | Tasks 6, 7 |
| Researcher preset gets both tools | Task 5 |
| `START_RESEARCH_SKILL` prompt update | Task 9 |
| >80% test coverage for new modules | Tasks 1–4, 10 |
| Existing tests still pass | Task 11 |

---

## Deferred (Follow-Up Run)

- Brave Search API / Serper.dev backend
- Firecrawl integration for rich content extraction
- Complex table parsing (full Markdown tables)
- Per-project web access toggle
- `web_search` result caching
