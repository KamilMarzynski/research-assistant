import { describe, expect, it } from "vitest";
import { generateProjectSlug, toSlug } from "./slug";

describe("toSlug", () => {
  it("converts to lowercase with spaces as hyphens", () => {
    expect(toSlug("My Cool Project")).toBe("my-cool-project");
  });

  it("strips non-alphanumeric characters", () => {
    expect(toSlug("My Cool Project!")).toBe("my-cool-project");
  });

  it("collapses multiple spaces", () => {
    expect(toSlug("hello   world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toSlug("!hello world!")).toBe("hello-world");
  });

  it("handles empty string", () => {
    expect(toSlug("")).toBe("");
  });

  it("handles all-special characters", () => {
    expect(toSlug("!!!")).toBe("");
  });
});

describe("generateProjectSlug", () => {
  it("combines base slug with 6-char uuid suffix", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(generateProjectSlug("My Project", id)).toBe("my-project-123456");
  });

  it("uses 'project' fallback when name is empty after slugify", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    expect(generateProjectSlug("!!!", id)).toBe("project-abcdef");
  });

  it("strips dashes from id for suffix", () => {
    const id = "a-b-c-d-e-f-1-2-3";
    expect(generateProjectSlug("Test", id)).toBe("test-abcdef");
  });
});
