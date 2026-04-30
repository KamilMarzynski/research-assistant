import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { extractMarkdown } from "./html-extractor";
import { assertSafeUrl } from "./ssrf-guard";

export function createFetchUrlTool(): AgentTool<
  typeof fetchUrlParameters,
  { url: string; title: string }
> {
  return {
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch a web page and return its content as Markdown. The URL must be http or https. Private IP addresses and local network addresses are blocked for security.",
    parameters: fetchUrlParameters,
    execute: async (
      _id,
      { url, maxChars: rawMaxChars },
    ): Promise<AgentToolResult<{ url: string; title: string }>> => {
      const maxChars = rawMaxChars !== undefined && rawMaxChars <= 0 ? 50_000 : rawMaxChars;
      const safeUrl = await assertSafeUrl(url, { followRedirects: true, maxRedirects: 5 });

      let response: Response;
      try {
        response = await fetch(safeUrl, { signal: AbortSignal.timeout(15000) });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Fetch timed out after 15s for ${safeUrl}`);
        }
        throw error;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${safeUrl}`);
      }

      const cl = response.headers.get("content-length");
      if (cl !== null) {
        const contentLength = Number.parseInt(cl, 10);
        if (!Number.isNaN(contentLength) && contentLength > 10_000_000) {
          throw new Error(`Content too large: ${cl} bytes (max 10MB)`);
        }
      }

      const html = await response.text();
      const { title, markdown } = extractMarkdown(html, { maxChars });

      return {
        content: [{ type: "text" as const, text: `# ${title}\n\n${markdown}` }],
        details: { url: safeUrl, title },
      };
    },
  };
}

const fetchUrlParameters = Type.Object({
  url: Type.String({ description: "The URL to fetch" }),
  maxChars: Type.Optional(
    Type.Number({ description: "Maximum number of characters to return from the page content" }),
  ),
});
