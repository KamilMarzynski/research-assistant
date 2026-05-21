import { describe, expect, it, vi } from "vitest";
import {
  enterPathApprovalGate,
  onPathApprovalTimeout,
  resolvePathApprovalGate,
} from "../extensions/path-approval";

describe("path-approval", () => {
  it("resolves approved when gate exists", async () => {
    const promise = enterPathApprovalGate("p1", "/tmp/file", "read");
    resolvePathApprovalGate("p1", "/tmp/file", "read", true);
    const result = await promise;
    expect(result.approved).toBe(true);
  });

  it("resolves denied when gate exists", async () => {
    const promise = enterPathApprovalGate("p1", "/tmp/file", "write");
    resolvePathApprovalGate("p1", "/tmp/file", "write", false, "not allowed");
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.denyReason).toBe("not allowed");
  });

  it("does nothing when resolving a non-existent gate", () => {
    expect(() => resolvePathApprovalGate("p1", "/missing", "read", true)).not.toThrow();
  });

  it("registers timeout handler and returns cleanup", () => {
    const cleanup = onPathApprovalTimeout("p1", "/tmp/file", "read", () => {});
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("cleanup removes handler from existing set", () => {
    const handler = () => {};
    const cleanup = onPathApprovalTimeout("p2", "/tmp/file", "read", handler);
    cleanup();
    // Calling cleanup again when set is empty should not throw
    expect(() => cleanup()).not.toThrow();
  });

  it("cleanup does not throw when key already removed", () => {
    const handler = () => {};
    const cleanup = onPathApprovalTimeout("p3", "/tmp/file", "read", handler);
    // Simulate another caller removing the key
    resolvePathApprovalGate("p3", "/tmp/file", "read", true);
    expect(() => cleanup()).not.toThrow();
  });

  it("supports multiple handlers for the same key and removes only the requested one", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const cleanup1 = onPathApprovalTimeout("p4", "/tmp/file", "read", handler1);
    const cleanup2 = onPathApprovalTimeout("p4", "/tmp/file", "read", handler2);
    cleanup1();
    expect(() => cleanup2()).not.toThrow();
  });
});
