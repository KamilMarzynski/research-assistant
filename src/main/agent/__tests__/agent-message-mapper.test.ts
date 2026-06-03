import { describe, expect, it } from "vitest";
import { toAgentMessages } from "../agent-message-mapper";

describe("toAgentMessages", () => {
  it("returns an empty array for empty input", () => {
    expect(toAgentMessages([])).toEqual([]);
  });

  it("maps user messages to plain-string content", () => {
    const result = toAgentMessages([{ role: "user", content: "hello" }]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("hello");
    expect(typeof result[0].timestamp).toBe("number");
  });

  it("wraps assistant messages in a text part block", () => {
    const result = toAgentMessages([{ role: "assistant", content: "hi back" }]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toEqual([{ type: "text", text: "hi back" }]);
  });

  it("preserves order across mixed roles", () => {
    const result = toAgentMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});
