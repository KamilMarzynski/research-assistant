import { describe, expect, it } from "vitest";
import { SummaryQueue } from "../SummaryQueue";

describe("SummaryQueue", () => {
  it("push and pop in FIFO order", () => {
    const q = new SummaryQueue();
    q.push("p1", "first");
    q.push("p1", "second");
    expect(q.pop("p1")).toBe("first");
    expect(q.pop("p1")).toBe("second");
    expect(q.pop("p1")).toBeUndefined();
  });

  it("hasItems returns false for empty project", () => {
    const q = new SummaryQueue();
    expect(q.hasItems("p1")).toBe(false);
    q.push("p1", "x");
    expect(q.hasItems("p1")).toBe(true);
    q.pop("p1");
    expect(q.hasItems("p1")).toBe(false);
  });

  it("queues are independent per projectId", () => {
    const q = new SummaryQueue();
    q.push("a", "alpha");
    q.push("b", "beta");
    expect(q.pop("a")).toBe("alpha");
    expect(q.hasItems("b")).toBe(true);
    expect(q.hasItems("a")).toBe(false);
  });

  it("peek does not remove item", () => {
    const q = new SummaryQueue();
    q.push("p1", "hello");
    expect(q.peek("p1")).toBe("hello");
    expect(q.hasItems("p1")).toBe(true);
  });

  it("pop and peek on unknown projectId return undefined", () => {
    const q = new SummaryQueue();
    expect(q.pop("unknown")).toBeUndefined();
    expect(q.peek("unknown")).toBeUndefined();
    expect(q.hasItems("unknown")).toBe(false);
  });

  it("repopulating a drained queue works", () => {
    const q = new SummaryQueue();
    q.push("p1", "a");
    expect(q.pop("p1")).toBe("a");
    expect(q.hasItems("p1")).toBe(false);
    q.push("p1", "b");
    expect(q.hasItems("p1")).toBe(true);
    expect(q.pop("p1")).toBe("b");
  });
});
