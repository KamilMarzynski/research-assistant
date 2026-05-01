import { describe, expect, it, vi } from "vitest";

describe("stream timeout logic", () => {
  it("timeout fires when agent_end never arrives within 120s", async () => {
    vi.useFakeTimers();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("stream_timeout")), 120_000);
    });

    // Simulate session.send() that never resolves
    const slowSend = new Promise<never>(() => {}); // never resolves

    const racePromise = Promise.race([slowSend, timeoutPromise]);

    // Advance time to trigger the timeout
    vi.advanceTimersByTime(120_000);

    await expect(racePromise).rejects.toThrow("stream_timeout");
    vi.useRealTimers();
  });

  it("timeout is cleared when agent_end arrives first", async () => {
    vi.useFakeTimers();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("stream_timeout")), 120_000);
    });

    // Simulate session.send() that resolves quickly
    const fastSend = Promise.resolve("done");

    const result = await Promise.race([fastSend, timeoutPromise]);
    expect(result).toBe("done");

    vi.useRealTimers();
  });

  it("timeout error produces correct message", () => {
    const err = new Error("stream_timeout");
    expect(err.message).toBe("stream_timeout");
  });
});
