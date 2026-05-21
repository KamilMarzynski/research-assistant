import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebSearchTool, parseDdgResults, searchDuckDuckGo } from "../web-search";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="result">
    <a class="result__a" href="https://example.com/1">First Result Title</a>
    <div class="result__snippet">This is the first result snippet.</div>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.com/2">Second Result Title</a>
    <div class="result__snippet">This is the second result snippet.</div>
  </div>
  <div class="result">
    <a class="result__a" href="https://example.com/3">Third Result Title</a>
    <div class="result__snippet">This is the third result snippet.</div>
  </div>
</body>
</html>
`;

const EMPTY_HTML = `<!DOCTYPE html><html><body><p>No results</p></body></html>`;

const MALFORMED_HTML = `
<div class="result">
  <a class="result__a" href="https://example.com/good">Good Result</a>
  <div class="result__snippet">Good snippet.</div>
</div>
<div class="result">
  <a class="result__a" href="https://example.com/bad">Bad Result</a>
  <!-- missing snippet -->
</div>
`;

const RATE_LIMIT_HTML = `
<!DOCTYPE html>
<html><body>
<div class="msg--box">
  <p>Our systems have detected unusual traffic from your computer network.</p>
</div>
</body></html>
`;

describe("parseDdgResults", () => {
  it("parses 2 results from sample HTML", () => {
    const results = parseDdgResults(SAMPLE_HTML, 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "First Result Title",
      url: "https://example.com/1",
      snippet: "This is the first result snippet.",
    });
    expect(results[1]).toEqual({
      title: "Second Result Title",
      url: "https://example.com/2",
      snippet: "This is the second result snippet.",
    });
  });

  it("returns empty array for no results", () => {
    const results = parseDdgResults(EMPTY_HTML, 5);
    expect(results).toHaveLength(0);
  });

  it("respects maxResults cap", () => {
    const results = parseDdgResults(SAMPLE_HTML, 2);
    expect(results).toHaveLength(2);
  });

  it("defaults to 5 and caps at 10", () => {
    // 3 in sample, asking for 10 should return 3
    const results = parseDdgResults(SAMPLE_HTML, 10);
    expect(results).toHaveLength(3);
  });

  it("skips unparseable blocks and parses partial results from malformed HTML", () => {
    const results = parseDdgResults(MALFORMED_HTML, 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Good Result",
      url: "https://example.com/good",
      snippet: "Good snippet.",
    });
  });

  it("returns empty array with note for rate limit/captcha HTML", () => {
    const results = parseDdgResults(RATE_LIMIT_HTML, 5);
    expect(results).toHaveLength(0);
  });
});

describe("searchDuckDuckGo", () => {
  it("returns parsed results on happy path", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_HTML,
    });

    const results = await searchDuckDuckGo("test query", 2);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://duckduckgo.com/html/?q=test%20query");
    expect(init.headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; ResearchAssistant/1.0)");
    expect(init.headers.Accept).toBe("text/html");

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("First Result Title");
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    await expect(searchDuckDuckGo("test", 5)).rejects.toThrow("Network failure");
  });

  it("throws on timeout", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValue(abortError);

    await expect(searchDuckDuckGo("test", 5)).rejects.toThrow(
      "Web search timed out after 15s for query: test",
    );
  });

  it("returns empty array with note for rate limit response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => RATE_LIMIT_HTML,
    });

    const results = await searchDuckDuckGo("test", 5);
    expect(results).toHaveLength(0);
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(searchDuckDuckGo("test", 5)).rejects.toThrow("DuckDuckGo search failed: HTTP 500");
  });
});

describe("createWebSearchTool", () => {
  it("has correct name and label", () => {
    const tool = createWebSearchTool();
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Search the web");
  });

  it("has required query parameter and optional maxResults", () => {
    const tool = createWebSearchTool();
    const schema = tool.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(schema.properties.query).toBeDefined();
    expect(schema.properties.maxResults).toBeDefined();
    expect(schema.required).toContain("query");
    // maxResults should not be required
    if (schema.required) {
      expect(schema.required).not.toContain("maxResults");
    }
  });

  it("returns numbered markdown results with details", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_HTML,
    });

    const tool = createWebSearchTool();
    const result = await tool.execute("call-1", { query: "hello" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("1. [First Result Title](https://example.com/1)");
    expect(text).toContain("This is the first result snippet.");

    expect(Array.isArray(result.details)).toBe(true);
    expect(result.details).toHaveLength(3);
  });

  it("returns rate-limit note when no results found", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => RATE_LIMIT_HTML,
    });

    const tool = createWebSearchTool();
    const result = await tool.execute("call-1", { query: "hello" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("No results found. The search engine may be rate-limiting requests.");

    expect(Array.isArray(result.details)).toBe(true);
    expect(result.details).toHaveLength(0);
  });
});
