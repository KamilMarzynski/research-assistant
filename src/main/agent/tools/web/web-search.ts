import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DEFAULT_MAX_RESULTS = 5;
const ABSOLUTE_MAX_RESULTS = 10;

/**
 * Parse DuckDuckGo HTML search results using regex.
 * Returns an array of { title, url, snippet } objects.
 */
export function parseDdgResults(html: string, maxResults: number): WebSearchResult[] {
  // Detect rate-limit / captcha pages
  if (html.includes("unusual traffic") || html.includes("msg--box")) {
    return [];
  }

  const results: WebSearchResult[] = [];

  // Find all .result__a links globally, then pair each with the next .result__snippet
  const linkRegex =
    /<a[^>]*class\s*=\s*"[^"]*result__a[^"]*"[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

  let linkMatch: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration pattern
  while ((linkMatch = linkRegex.exec(html)) !== null && results.length < maxResults) {
    const url = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();

    // Find the next .result__snippet after this link
    const searchStart = linkMatch.index + linkMatch[0].length;
    const snippetRegex = /<div[^>]*class\s*=\s*"[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const snippetMatch = snippetRegex.exec(html.slice(searchStart));
    if (!snippetMatch) continue;

    const snippet = snippetMatch[1].replace(/<[^>]+>/g, "").trim();

    results.push({ title, url, snippet });
  }

  return results;
}

/**
 * Search DuckDuckGo HTML endpoint and parse results.
 */
export async function searchDuckDuckGo(
  query: string,
  maxResults = DEFAULT_MAX_RESULTS,
): Promise<WebSearchResult[]> {
  const cappedMax = Math.min(Math.max(1, maxResults), ABSOLUTE_MAX_RESULTS);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchAssistant/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    return parseDdgResults(html, cappedMax);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Web search timed out after 15s for query: ${query}`);
    }
    throw error;
  }
}

/**
 * Build the formatted text content from search results.
 */
function formatResults(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return "No results found. The search engine may be rate-limiting requests.";
  }

  return results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n${r.snippet}`).join("\n\n");
}

/**
 * Create the web_search AgentTool.
 */
export function createWebSearchTool(): AgentTool<
  ReturnType<typeof webSearchParameters>,
  WebSearchResult[]
> {
  return {
    name: "web_search",
    label: "Search the web",
    description:
      "Search the web using DuckDuckGo. Returns titles, URLs, and snippets. No API key required.",
    parameters: webSearchParameters(),
    execute: async (_id, { query, maxResults }): Promise<AgentToolResult<WebSearchResult[]>> => {
      const cappedMax = Math.min(
        Math.max(1, maxResults ?? DEFAULT_MAX_RESULTS),
        ABSOLUTE_MAX_RESULTS,
      );
      const results = await searchDuckDuckGo(query, cappedMax);
      const text = formatResults(results);
      return {
        content: [{ type: "text" as const, text }],
        details: results,
      };
    },
  };
}

function webSearchParameters() {
  return Type.Object(
    {
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default 5, max 10)",
          default: DEFAULT_MAX_RESULTS,
          minimum: 1,
          maximum: ABSOLUTE_MAX_RESULTS,
        }),
      ),
    },
    { description: "Search the web using DuckDuckGo" },
  );
}
