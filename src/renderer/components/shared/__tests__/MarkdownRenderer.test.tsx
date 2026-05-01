// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import MarkdownRenderer from "../MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("returns null for empty content", () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders without crashing", () => {
    expect(() => render(<MarkdownRenderer content="# Hello\n\nWorld" />)).not.toThrow();
  });

  it("renders code blocks", () => {
    const { container } = render(<MarkdownRenderer content="```ts\nconst x = 1;\n```" />);
    const codeEl = container.querySelector("code");
    expect(codeEl).toBeTruthy();
    expect(codeEl?.textContent).toContain("const x = 1");
  });

  it("renders links", () => {
    const { container } = render(<MarkdownRenderer content="[click](https://example.com)" />);
    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("https://example.com");
  });

  it("handles malformed markdown without crashing", () => {
    expect(() =>
      render(<MarkdownRenderer content="# Unclosed <tag> **bold *** " />),
    ).not.toThrow();
  });
});
