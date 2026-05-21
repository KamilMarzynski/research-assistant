import { describe, expect, it } from "vitest";
import { pruneMessages } from "../message-context-pruner";

type Msg = { role: "user" | "assistant"; content: string };
const makeMsg = (role: "user" | "assistant", content: string): Msg => ({ role, content });

describe("pruneMessages", () => {
  it("returns all messages when total tokens under budget", () => {
    const messages = [makeMsg("user", "hi"), makeMsg("assistant", "hello")];
    const result = pruneMessages(messages as any, 200_000);
    expect(result).toHaveLength(2);
  });

  it("drops oldest messages when over budget", () => {
    const messages = [
      makeMsg("user", "a".repeat(100)),
      makeMsg("assistant", "b".repeat(100)),
      makeMsg("user", "c".repeat(100)),
    ];
    const result = pruneMessages(messages as any, 40);
    expect(result.length).toBeLessThan(3);
    const last = result[result.length - 1];
    expect((last.content as string)[0]).toBe("c");
  });

  it("always keeps last user message even if over budget", () => {
    const messages = [makeMsg("user", "x".repeat(1000))];
    const result = pruneMessages(messages as any, 10);
    expect(result).toHaveLength(1);
  });

  it("handles array content messages", () => {
    const messages = [
      { role: "user", content: [{ text: "hello" }] },
      { role: "assistant", content: [{ text: "world" }] },
    ];
    const result = pruneMessages(messages as any, 200_000);
    expect(result).toHaveLength(2);
  });

  it("handles non-string non-array content", () => {
    const messages = [
      { role: "user", content: { foo: "bar" } },
      { role: "assistant", content: "plain text" },
    ];
    const result = pruneMessages(messages as any, 200_000);
    expect(result).toHaveLength(2);
  });

  it("keeps user message when budget exceeded by an earlier message", () => {
    const messages = [makeMsg("assistant", "a".repeat(100)), makeMsg("user", "x".repeat(100))];
    const result = pruneMessages(messages as any, 40);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
  });

  it("handles array content with missing text property", () => {
    const messages = [{ role: "user", content: [{ text: "hello " }, {}, { text: "world" }] }];
    const result = pruneMessages(messages as any, 200_000);
    expect(result).toHaveLength(1);
  });
});
