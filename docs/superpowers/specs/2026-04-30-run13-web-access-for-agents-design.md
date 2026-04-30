# Run 13 — Web Access for Agents Design

> **Scope:** Add `fetch_url` and `web_search` tools to the researcher agent, with SSRF protection, HTML-to-Markdown extraction, and DuckDuckGo search. Include a global settings toggle.
>
> **Approach:** Modular tool suite in `src/main/agent/tools/web/` — each unit independently testable.
>
> **Date:** 2026-04-30

---

## 1. Motivation

Research agents currently have no internet access. The `safe_bash` blocklist explicitly forbids `curl` and `wget`. Background research is limited to files already on disk or code the agent writes itself.

Adding `fetch_url` and `web_search` makes background research useful — agents can read documentation, papers, articles, and search the web for current information.

---

## 2. Architecture

```
src/main/agent/tools/web/
├── ssrf-guard.ts       — DNS resolve + private IP block + redirect following (max 5 hops)
├── html-extractor.ts   — regex-based HTML → Markdown extraction
├── fetch-url.ts        — fetch_url tool implementation
├── web-search.ts       — web_search tool implementation (DuckDuckGo)

src/main/agent/
├── tools.ts            — wire fetch_url + web_search into createAgentTools
├── worker-agent.ts     — researcher preset gets both tools
├── builtin-skills.ts   — update START_RESEARCH_SKILL prompt

src/main/services/
├── SettingsService.ts  — add webAccessEnabled: boolean (default true)

src/renderer/components/settings/
├── SettingsModal.tsx   — add "Web Access" toggle
```

No new IPC channels for the tools themselves — they execute synchronously within Pi's tool call, same pattern as `safe_bash`.

---

## 3. Components

### 3.1 SSRF Guard (`ssrf-guard.ts`)

**Purpose:** Prevent agents from fetching internal/private network resources.

**Interface:**
```typescript
export async function assertSafeUrl(
  url: string,
  opts?: { maxRedirects?: number; followRedirects?: boolean }
): Promise<string>; // returns final resolved URL (after redirects)
```

**Algorithm:**
1. Parse URL → must have `http://` or `https://` protocol
2. Resolve hostname via `dns.promises.resolve4()` / `resolve6()`
3. Check each resolved IP against private ranges:
   - IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`
   - IPv6: `::1`, `fc00::/7`
4. If Ollama host is `localhost:11434`, exclude it from blocklist (agent may check Ollama availability)
5. If blocked: throw `Error("SSRF guard blocked {url}: resolved to private IP {ip}")`
6. If `followRedirects: true` and response is 3xx:
   - Parse `Location` header → recurse with same checks
   - Max 5 hops → throw on exceed

**Why `dns.promises.resolve()` instead of `new URL().hostname`?**
DNS resolution ensures the *actual IP* is checked, not just the hostname string. This catches `192.168.1.1.example.com` (which resolves to a public IP but contains a private IP in the hostname) as well as `evil.com` → A record `10.0.0.1`.

**Redirect following:**
- Use `fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) })`
- On 3xx, parse `Location` → run full `assertSafeUrl` on new URL → repeat
- Return the final resolved URL so the caller knows where it actually landed

### 3.2 HTML Extractor (`html-extractor.ts`)

**Purpose:** Convert raw HTML into clean Markdown for the agent.

**Interface:**
```typescript
export function extractMarkdown(html: string, opts?: { maxChars?: number }): {
  title: string;
  markdown: string;
};
```

**Transformation rules:**
| HTML | Markdown |
|------|----------|
| `<title>` | stored in `title` field (not in markdown body) |
| `<meta name="description" content="...">` | stored as `> Description: ...` block (if content present) |
| `<h1>`–`<h6>` | `#`–`###### ` |
| `<p>` | plain text + `\n\n` |
| `<a href="url">text</a>` | `[text](url)` |
| `<ul>/<ol>` | `- ` items, `1. ` items |
| `<li>` | `- ` or `1. ` prefix |
| `<code>` | `` `code` `` (inline) |
| `<pre><code>` | ` ``` ` fenced block |
| `<table>` | plain text rows (no complex table parsing — strip tags, keep `\|`) |
| `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<aside>` | remove entirely |
| all other tags | strip, keep inner text |

**Output cap:** Default `maxChars: 50000`. Truncate with `[...content truncated...]` marker.

**Implementation:**
Regex-based tag matching. No DOM parser dependency — Bun doesn't ship `jsdom`, adding it for this is overkill. The regex approach is sufficient for research content extraction.

### 3.3 `fetch_url` Tool (`fetch-url.ts`)

**Tool spec:**
```typescript
{
  name: "fetch_url",
  label: "Fetch URL",
  description: "Fetch a web page and return its content as clean Markdown. URL must be http or https. Internal/private IPs are blocked for security.",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch, must start with http:// or https://" }),
    maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return (default 50000)" })),
  }),
  execute: async (_id, { url, maxChars }): Promise<AgentToolResult<{ url: string; title: string }>> => {
    const safeUrl = await assertSafeUrl(url, { followRedirects: true, maxRedirects: 5 });
    const response = await fetch(safeUrl, { signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    const { title, markdown } = extractMarkdown(html, { maxChars });
    const summary = [`# ${title}`, markdown].join("\n\n");
    return {
      content: [{ type: "text" as const, text: summary }],
      details: { url: safeUrl, title },
    };
  },
}
```

**Error handling:**
- SSRF block → throw → Pi catches, agent sees error message → can self-correct
- Network timeout (15s) → throw → agent retries or tries different URL
- Non-2xx HTTP status → throw with status code
- HTML extraction failure → fallback to tag-stripped plain text (never crash)

### 3.4 `web_search` Tool (`web-search.ts`)

**Tool spec:**
```typescript
{
  name: "web_search",
  label: "Search the web",
  description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets. No API key required.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    maxResults: Type.Optional(Type.Number({ description: "Max results (default 5, max 10)" })),
  }),
  execute: async (_id, { query, maxResults }): Promise<AgentToolResult<Array<{ title: string; url: string; snippet: string }>>> => {
    const results = await searchDuckDuckGo(query, maxResults ?? 5);
    const text = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`).join("\n\n");
    return {
      content: [{ type: "text" as const, text }],
      details: results,
    };
  },
}
```

**DuckDuckGo scraping:**
- Endpoint: `https://duckduckgo.com/html/?q={encodeURIComponent(query)}`
- Headers: `User-Agent: Mozilla/5.0 (compatible; ResearchAssistant/1.0)`
- Parse `.result` CSS class blocks (regex-based, no `cheerio` dependency):
  - `.result__a` → title + URL
  - `.result__snippet` → snippet
- Return up to `maxResults` (capped at 10)

**Error handling:**
- DuckDuckGo rate limit / captcha → return `[]` with note in text: "No results found. The search engine may be rate-limiting requests."
- Network error → throw, agent retries
- Malformed HTML → parse partial results, skip unparseable blocks, no crash

**Why DuckDuckGo?**
Free, no API key, no signup. Lower quality than Brave Search but sufficient for MVP. Brave Search API and Serper.dev deferred to follow-up run.

---

## 4. Settings Toggle

### 4.1 Schema

Add to `AppSettings` in `src/main/services/SettingsService.ts`:
```typescript
webAccessEnabled: boolean; // default: true
```

### 4.2 Wiring

- `AgentToolsOptions` gets `webAccessEnabled?: boolean`
- `createAgentTools`: if `!opts.webAccessEnabled`, skip adding `fetch_url` and `web_search`
- `AgentSession` passes `webAccessEnabled` from settings to `createAgentTools`
- `WorkerAgentConfig` includes `webAccessEnabled?: boolean` → `createWorkerAgent` passes through
- `SettingsModal` adds checkbox: "Enable web access for agents" with tooltip explaining what it does

---

## 5. Tool Registration

### 5.1 `AgentToolName` Update

Add to union in `src/main/agent/tools.ts`:
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

### 5.2 Researcher Preset Update

In `worker-agent.ts`, researcher preset gets both tools:
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
  systemPromptAddition: `...`,
  remainingDepth: 0,
}),
```

### 5.3 `START_RESEARCH_SKILL` Update

Append to `builtin-skills.ts`:
```
## Web Access

Your researcher agents have two web access tools:

- **fetch_url** — fetch a specific web page and get clean Markdown content
- **web_search** — search DuckDuckGo for relevant pages

Use these when the research requires:
- Reading documentation, papers, articles, or blog posts
- Finding current information not in the project files
- Comparing approaches from external sources

**Note:** `safe_bash` still blocks `curl` and `wget`. Use `fetch_url` instead.
```

---

## 6. Testing Plan

### 6.1 Unit Tests (`src/main/agent/tools/web/`)

| File | Cases |
|------|-------|
| `ssrf-guard.test.ts` | Private IPv4 blocked (`10.0.0.1`, `192.168.1.1`, `127.0.0.1`, `169.254.0.1`, `172.16.0.1`)<br>Public IPv4 allowed (`93.184.216.34`)<br>IPv6 loopback blocked (`::1`)<br>IPv6 ULA blocked (`fc00::/7`)<br>Redirect chain: all public → allowed<br>Redirect chain: public → private → blocked at hop 2<br>Max redirects exceeded → throws<br>Ollama localhost excluded from block |
| `html-extractor.test.ts` | Full HTML → markdown with headings, paragraphs, links<br>Inline `<code>` → backtick inline<br>`<pre><code>` → fenced block<br>Table → plain text rows<br>Script/style tags stripped<br>Already plain text → passes through<br>Truncation at maxChars with marker |
| `web-search.test.ts` | Mock DDG HTML → parses 5 results correctly<br>Empty results → returns `[]`<br>Malformed HTML → partial results, no crash<br>`maxResults` cap respected (10 max) |

### 6.2 Integration Tests

- `tools.ts`: `createAgentTools` with `toolNames` containing `"fetch_url"` and `"web_search"` returns those tools
- `worker-agent.ts`: researcher preset includes both tools in its `toolNames`

### 6.3 No E2E Tests

Web access is a background tool — no new UI flows beyond a settings toggle. Manual verification sufficient.

---

## 7. Deferred to Follow-Up

| Item | Reason |
|------|--------|
| Brave Search API / Serper.dev | Requires API key management, safeStorage encryption. DuckDuckGo sufficient for MVP. |
| Firecrawl integration | Rich content extraction optional. Raw HTML extraction sufficient. |
| Complex table parsing | Regex approach handles basic tables. Full table → Markdown deferred. |
| `web_search` caching | No cache layer. Each search is live. |
| Per-project web access toggle | Global sufficient. Per-project adds complexity with marginal benefit. |

---

## 8. Success Criteria

- [ ] Researcher agents can call `fetch_url` and receive clean Markdown
- [ ] `fetch_url` blocks private IPs (SSRF protection)
- [ ] Redirect chains are followed and re-checked at each hop
- [ ] `web_search` returns DuckDuckGo results as structured text
- [ ] Settings toggle enables/disables both tools
- [ ] All new modules have >80% test coverage
- [ ] Existing 234 Vitest + 4 Playwright e2e specs still pass
- [ ] `START_RESEARCH_SKILL` mentions new tools

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DuckDuckGo blocks scraping (captcha/rate limit) | Medium | Medium | Return empty results with note; agent retries or uses `fetch_url` with known URLs |
| SSRF blocklist incomplete (redirect chain edge cases) | Low | Medium | Max 5 redirects + re-check each target; throw on any private IP in chain |
| HTML extraction produces garbled markdown | Medium | Low | Fallback to tag-stripped plain text; regex tuned on common patterns |
| Pi SDK tool parameter shape mismatch | Low | High | Follow existing `makeTool` + `Type.Object` pattern; test tool registration |

---

## 10. Related Documents

- `2026-04-30-run12-model-provider-abstraction-design.md` — Run 12 design (preceding run)
- `2026-04-30-run11-safe-bash-approval-gate-design.md` — Run 11 design (safety foundation)
- `04 Resources/AI/Research Assistant - Next Iteration Specification.md` — Vault iteration spec §5
