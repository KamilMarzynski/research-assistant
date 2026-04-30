import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import * as dns from "node:dns/promises";
import { assertSafeUrl, isPrivateIp } from "../ssrf-guard";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const mockResolve4 = dns.resolve4 as ReturnType<typeof vi.fn>;
const mockResolve6 = dns.resolve6 as ReturnType<typeof vi.fn>;

// Default mock implementations so .catch() works in runSafetyChecks
mockResolve4.mockResolvedValue([]);
mockResolve6.mockResolvedValue([]);

describe("isPrivateIp", () => {
  it("blocks 10.0.0.1", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
  });

  it("blocks 172.16.0.1", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
  });

  it("blocks 192.168.1.1", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });

  it("blocks 127.0.0.1", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("blocks 169.254.0.1", () => {
    expect(isPrivateIp("169.254.0.1")).toBe(true);
  });

  it("allows 93.184.216.34", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });

  it("blocks ::1", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("blocks fc00::1", () => {
    expect(isPrivateIp("fc00::1")).toBe(true);
  });

  it("allows 2001:db8::1", () => {
    expect(isPrivateIp("2001:db8::1")).toBe(false);
  });

  it("blocks 0.0.0.0", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("blocks fe80::1", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("blocks ::ffff:192.168.1.1 (IPv4-mapped private)", () => {
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  beforeEach(() => {
    mockResolve4.mockClear();
    mockResolve6.mockClear();
  });

  it("throws for http://10.0.0.1/path", async () => {
    await expect(assertSafeUrl("http://10.0.0.1/path")).rejects.toThrow(
      /SSRF guard blocked.*10\.0\.0\.1.*private IP/,
    );
  });

  it("throws for http://localhost:8080", async () => {
    mockResolve4.mockResolvedValue(["127.0.0.1"]);
    await expect(assertSafeUrl("http://localhost:8080")).rejects.toThrow(
      /SSRF guard blocked.*localhost.*private IP/,
    );
  });

  it("throws for http://127.0.0.1:11434", async () => {
    await expect(assertSafeUrl("http://127.0.0.1:11434")).rejects.toThrow(
      /SSRF guard blocked.*127\.0\.0\.1.*private IP/,
    );
  });

  it("allows http://example.com", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    const result = await assertSafeUrl("http://example.com");
    expect(result).toBe("http://example.com");
  });

  it("allows https://github.com", async () => {
    mockResolve4.mockResolvedValue(["140.82.121.4"]);
    const result = await assertSafeUrl("https://github.com");
    expect(result).toBe("https://github.com");
  });

  it("throws for DNS resolution failure", async () => {
    mockResolve4.mockRejectedValue(new Error("DNS error"));
    mockResolve6.mockRejectedValue(new Error("DNS error"));
    await expect(assertSafeUrl("http://nonexistent.host")).rejects.toThrow(
      /SSRF guard blocked.*could not resolve hostname/,
    );
  });

  it("throws for malformed URL", async () => {
    await expect(assertSafeUrl("not-a-url")).rejects.toThrow(/SSRF guard blocked.*invalid URL/);
  });
});

describe("assertSafeUrl redirect following", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockResolve4.mockClear();
    mockResolve6.mockClear();
  });

  it("redirect chain all public → allowed, returns final URL", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockFetch
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: "http://example.com/final" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
      });

    const result = await assertSafeUrl("http://example.com", { followRedirects: true });
    expect(result).toBe("http://example.com/final");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("redirect chain public → private → blocked at hop 2", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockFetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "http://127.0.0.1/secret" }),
    });

    await expect(assertSafeUrl("http://example.com", { followRedirects: true })).rejects.toThrow(
      /SSRF guard blocked.*127\.0\.0\.1.*private IP/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("max redirects exceeded (>5) → throws", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockFetch.mockResolvedValue({
      status: 302,
      headers: new Headers({ location: "http://example.com/next" }),
    });

    await expect(assertSafeUrl("http://example.com", { followRedirects: true })).rejects.toThrow(
      /SSRF guard blocked.*max redirects exceeded/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
