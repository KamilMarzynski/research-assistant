import { describe, expect, it } from "vitest";
import { SendThrottle } from "../send-throttle";

describe("SendThrottle", () => {
  it("serializes concurrent sends for same projectId", async () => {
    const order: number[] = [];
    const throttle = new SendThrottle(0); // 0ms throttle for test speed

    const p1 = throttle.acquire("proj1").then(async (release) => {
      order.push(1);
      await new Promise<void>((r) => setTimeout(r, 10));
      order.push(2);
      release();
    });
    const p2 = throttle.acquire("proj1").then(async (release) => {
      order.push(3);
      release();
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]); // p2 waits for p1 to finish
  });

  it("allows concurrent sends for different projectIds", async () => {
    const order: number[] = [];
    const throttle = new SendThrottle(0);

    const p1 = throttle.acquire("proj1").then(async (release) => {
      order.push(1);
      await new Promise<void>((r) => setTimeout(r, 10));
      order.push(2);
      release();
    });
    const p2 = throttle.acquire("proj2").then(async (release) => {
      order.push(3);
      release();
    });

    await Promise.all([p1, p2]);
    // proj2 should be able to start before proj1 finishes (order: 1, 3, 2)
    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order).toContain(3);
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(2));
  });

  it("enforces throttle interval between sends", async () => {
    const throttle = new SendThrottle(50); // 50ms throttle
    const times: number[] = [];

    const r1 = await throttle.acquire("proj1");
    times.push(Date.now());
    r1();

    const r2 = await throttle.acquire("proj1");
    times.push(Date.now());
    r2();

    expect(times[1] - times[0]).toBeGreaterThanOrEqual(40); // allow some slack
  });
});
