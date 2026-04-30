import { resolve4, resolve6 } from "node:dns/promises";

export interface SsrfGuardOptions {
  followRedirects?: boolean;
  maxRedirects?: number;
}

function expandIpv6(ip: string): number[] | null {
  if (!ip.includes(":")) return null;

  const doubleColonCount = (ip.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let parts: string[];

  if (ip.includes("::")) {
    const [left, right] = ip.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const lastRight = rightParts[rightParts.length - 1];
    if (lastRight?.includes(".")) {
      const ipv4Parts = lastRight.split(".").map(Number);
      if (
        ipv4Parts.length === 4 &&
        ipv4Parts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255)
      ) {
        rightParts.pop();
        rightParts.push(((ipv4Parts[0] << 8) | ipv4Parts[1]).toString(16));
        rightParts.push(((ipv4Parts[2] << 8) | ipv4Parts[3]).toString(16));
      } else {
        return null;
      }
    }
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) return null;
    const zeros = Array(missing).fill("0");
    parts = [...leftParts, ...zeros, ...rightParts];
  } else {
    parts = ip.split(":");
    const lastPart = parts[parts.length - 1];
    if (lastPart?.includes(".")) {
      const ipv4Parts = lastPart.split(".").map(Number);
      if (
        ipv4Parts.length === 4 &&
        ipv4Parts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255)
      ) {
        parts.pop();
        parts.push(((ipv4Parts[0] << 8) | ipv4Parts[1]).toString(16));
        parts.push(((ipv4Parts[2] << 8) | ipv4Parts[3]).toString(16));
      } else {
        return null;
      }
    }
  }

  if (parts.length !== 8) return null;

  const nums = parts.map((p) => parseInt(p || "0", 16));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;

  return nums;
}

export function isPrivateIp(ip: string): boolean {
  // IPv6 (check first — catches IPv4-mapped addresses like ::ffff:127.0.0.1)
  if (ip.includes(":")) {
    const groups = expandIpv6(ip);
    if (groups === null) return false;

    // Loopback ::1
    if (groups.every((g, i) => (i === 7 ? g === 1 : g === 0))) return true;

    // ULA fc00::/7
    if ((groups[0] & 0xfe00) === 0xfc00) return true;

    // Link-local fe80::/10
    if ((groups[0] & 0xffc0) === 0xfe80) return true;

    // IPv4-mapped ::ffff:x.x.x.x
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const mappedIpv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
      return isPrivateIp(mappedIpv4);
    }

    return false;
  }

  // IPv4
  if (ip.includes(".")) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return false;
    }
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }

  return false;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255);
}

function isValidIpv6(ip: string): boolean {
  return expandIpv6(ip) !== null;
}

async function runSafetyChecks(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SSRF guard blocked ${url}: invalid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF guard blocked ${url}: only http and https protocols are allowed`);
  }

  const hostname = parsed.hostname;

  if (isValidIpv4(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`SSRF guard blocked ${url}: resolved to private IP ${hostname}`);
    }
    return;
  }

  if (isValidIpv6(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`SSRF guard blocked ${url}: resolved to private IP ${hostname}`);
    }
    return;
  }

  let ipv4Error = false;
  let ipv6Error = false;
  const ipv4s = await resolve4(hostname).catch(() => {
    ipv4Error = true;
    return [] as string[];
  });
  const ipv6s = await resolve6(hostname).catch(() => {
    ipv6Error = true;
    return [] as string[];
  });

  if (ipv4Error && ipv6Error) {
    throw new Error(`SSRF guard blocked ${url}: could not resolve hostname`);
  }

  for (const ip of [...ipv4s, ...ipv6s]) {
    if (isPrivateIp(ip)) {
      throw new Error(`SSRF guard blocked ${url}: resolved to private IP ${ip}`);
    }
  }
}

export async function assertSafeUrl(url: string, opts?: SsrfGuardOptions): Promise<string> {
  await runSafetyChecks(url);

  if (!opts?.followRedirects) {
    return url;
  }

  const maxRedirects = opts.maxRedirects ?? 5;
  if (maxRedirects <= 0) {
    throw new Error(`SSRF guard blocked ${url}: max redirects exceeded`);
  }

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      const resolved = new URL(location, url).href;
      return assertSafeUrl(resolved, { ...opts, maxRedirects: maxRedirects - 1 });
    }
  }

  return url;
}
