import { describe, expect, it } from "vitest";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  it("get returns undefined for unknown id", () => {
    const sm = new SessionManager();
    expect(sm.get("unknown")).toBeUndefined();
  });

  it("set + get round-trip", () => {
    const sm = new SessionManager();
    const mockSession = { projectId: "p1" } as never;
    sm.set("p1", mockSession);
    expect(sm.get("p1")).toBe(mockSession);
  });

  it("delete removes session", () => {
    const sm = new SessionManager();
    sm.set("p1", {} as never);
    sm.delete("p1");
    expect(sm.get("p1")).toBeUndefined();
  });

  it("clear removes all sessions", () => {
    const sm = new SessionManager();
    sm.set("p1", {} as never);
    sm.set("p2", {} as never);
    sm.clear();
    expect(sm.get("p1")).toBeUndefined();
    expect(sm.get("p2")).toBeUndefined();
  });

  it("set overwrites existing entry", () => {
    const sm = new SessionManager();
    const old = { projectId: "p1" } as never;
    const updated = { projectId: "p1" } as never;
    sm.set("p1", old);
    sm.set("p1", updated);
    expect(sm.get("p1")).toBe(updated);
  });
});
