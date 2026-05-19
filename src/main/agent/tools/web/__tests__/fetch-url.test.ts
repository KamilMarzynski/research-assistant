import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchUrlTool } from "../fetch-url";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
  resolve6: vi.fn().mockResolvedValue([]),
}));

describe("createFetchUrlTool", () => {
  describe("metadata", () => {
    it("returns a tool with name 'fetch_url' and label 'Fetch URL'", () => {
      const tool = createFetchUrlTool();
      expect(tool.name).toBe("fetch_url");
      expect(tool.label).toBe("Fetch URL");
    });

    it("has a description mentioning http/https and private IP blocking", () => {
      const tool = createFetchUrlTool();
      expect(tool.description).toContain("http");
      expect(tool.description).toContain("https");
      expect(tool.description.toLowerCase()).toContain("private");
    });

    it("parameters include required 'url' string", () => {
      const tool = createFetchUrlTool();
      const params = tool.parameters;

      expect(params.type).toBe("object");
      expect(params.properties).toBeDefined();
      expect(params.properties.url).toBeDefined();
      expect(params.properties.url.type).toBe("string");
      expect(params.required).toContain("url");
    });

    it("parameters include optional 'maxChars' number", () => {
      const tool = createFetchUrlTool();
      const params = tool.parameters;

      expect(params.properties.maxChars).toBeDefined();
      expect(params.properties.maxChars.type).toBe("number");
      expect(params.required).not.toContain("maxChars");
    });
  });

  describe("execute", () => {
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

    it("happy path: returns markdown and details for a 200 response", async () => {
      const html = `<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>`;
      const mockResponse = new Response(html, {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html" }),
      });

      // assertSafeUrl fetch + main fetch both return 200
      mockFetch.mockResolvedValue(mockResponse);

      const tool = createFetchUrlTool();
      const result = await tool.execute("test-id", { url: "https://example.com" });

      expect(result.content).toHaveLength(1);
      const textItem = result.content[0] as { type: "text"; text: string };
      expect(textItem.type).toBe("text");
      expect(textItem.text).toContain("Test Page");
      expect(textItem.text).toContain("Hello world");
      expect(result.details).toEqual({ url: "https://example.com", title: "Test Page" });
    });

    it("throws HTTP error on 404 response", async () => {
      const okResponse = new Response("OK", {
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      });
      const notFoundResponse = new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
      });

      mockFetch.mockResolvedValueOnce(okResponse);
      mockFetch.mockResolvedValueOnce(notFoundResponse);

      const tool = createFetchUrlTool();
      await expect(tool.execute("test-id", { url: "https://example.com/missing" })).rejects.toThrow(
        "HTTP 404",
      );
    });

    it("throws timed out message on AbortError", async () => {
      const okResponse = new Response("OK", {
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      });
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      mockFetch.mockResolvedValueOnce(okResponse);
      mockFetch.mockRejectedValueOnce(abortError);

      const tool = createFetchUrlTool();
      await expect(tool.execute("test-id", { url: "https://example.com" })).rejects.toThrow(
        "timed out after 15s",
      );
    });

    it("throws content too large when content-length exceeds 10MB", async () => {
      const okResponse = new Response("OK", {
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      });
      const mockResponse = new Response("<html></html>", {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-length": "20000000" }),
      });

      const textSpy = vi.spyOn(mockResponse, "text");
      mockFetch.mockResolvedValueOnce(okResponse);
      mockFetch.mockResolvedValueOnce(mockResponse);

      const tool = createFetchUrlTool();
      await expect(tool.execute("test-id", { url: "https://example.com" })).rejects.toThrow(
        "Content too large",
      );
      expect(textSpy).not.toHaveBeenCalled();
    });

    it("clamps maxChars to 50000 when passed a negative value", async () => {
      const html = `<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>`;
      const mockResponse = new Response(html, {
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      });

      // assertSafeUrl fetch + main fetch both return 200
      mockFetch.mockResolvedValue(mockResponse);

      const tool = createFetchUrlTool();
      const result = await tool.execute("test-id", { url: "https://example.com", maxChars: -1 });

      expect(result.content).toHaveLength(1);
      const textItem = result.content[0] as { type: "text"; text: string };
      expect(textItem.type).toBe("text");
    });
  });
});
