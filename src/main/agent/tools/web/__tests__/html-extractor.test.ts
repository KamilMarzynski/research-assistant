import { describe, expect, it } from "vitest";
import { extractMarkdown, stripHtmlTags } from "../html-extractor";

describe("extractMarkdown", () => {
  it("extracts title from <title>", () => {
    const html = `<html><head><title>Hello World</title></head><body></body></html>`;
    const result = extractMarkdown(html);
    expect(result.title).toBe("Hello World");
  });

  it("converts h1-h6 to markdown headings", () => {
    const html = `
      <h1>Heading 1</h1>
      <h2>Heading 2</h2>
      <h3>Heading 3</h3>
      <h4>Heading 4</h4>
      <h5>Heading 5</h5>
      <h6>Heading 6</h6>
    `;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("# Heading 1");
    expect(result.markdown).toContain("## Heading 2");
    expect(result.markdown).toContain("### Heading 3");
    expect(result.markdown).toContain("#### Heading 4");
    expect(result.markdown).toContain("##### Heading 5");
    expect(result.markdown).toContain("###### Heading 6");
  });

  it("converts paragraphs", () => {
    const html = `<p>First paragraph.</p><p>Second paragraph.</p>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("First paragraph.\n\nSecond paragraph.");
  });

  it("converts links to markdown", () => {
    const html = `<a href="https://example.com">Example</a>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("[Example](https://example.com)");
  });

  it("converts inline code", () => {
    const html = `<p>Use <code>console.log</code> for debugging.</p>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("Use `console.log` for debugging.");
  });

  it("converts pre code blocks", () => {
    const html = `<pre><code>const x = 1;</code></pre>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("```\nconst x = 1;\n```");
  });

  it("strips script and style tags", () => {
    const html = `
      <p>Keep me</p>
      <script>alert('bad')</script>
      <style>body { color: red; }</style>
      <p>And me</p>
    `;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("Keep me");
    expect(result.markdown).toContain("And me");
    expect(result.markdown).not.toContain("alert");
    expect(result.markdown).not.toContain("color: red");
  });

  it("extracts meta description", () => {
    const html = `
      <head>
        <title>Page</title>
        <meta name="description" content="A description of the page.">
      </head>
      <body><p>Body text.</p></body>
    `;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("> Description: A description of the page.");
  });

  it("converts lists", () => {
    const html = `
      <ul>
        <li>Item one</li>
        <li>Item two</li>
      </ul>
      <ol>
        <li>First</li>
        <li>Second</li>
      </ol>
    `;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("- Item one");
    expect(result.markdown).toContain("- Item two");
    expect(result.markdown).toContain("- First");
    expect(result.markdown).toContain("- Second");
  });

  it("truncates at maxChars with marker", () => {
    const html = `<p>${"a".repeat(100_000)}</p>`;
    const result = extractMarkdown(html, { maxChars: 100 });
    expect(result.markdown.length).toBeLessThanOrEqual(120);
    expect(result.markdown).toContain("[...content truncated...]");
    expect(result.markdown.endsWith("[...content truncated...]")).toBe(true);
  });

  it("passes through plain text unchanged", () => {
    const text = "Just some plain text without HTML.";
    const result = extractMarkdown(text);
    expect(result.markdown).toBe("Just some plain text without HTML.");
    expect(result.title).toBe("");
  });

  it("strips nav, header, footer, and aside tags", () => {
    const html = `
      <nav>Navigation</nav>
      <header>Header</header>
      <p>Keep this</p>
      <footer>Footer</footer>
      <aside>Sidebar</aside>
    `;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("Keep this");
    expect(result.markdown).not.toContain("Navigation");
    expect(result.markdown).not.toContain("Header");
    expect(result.markdown).not.toContain("Footer");
    expect(result.markdown).not.toContain("Sidebar");
  });

  it("strips remaining tags keeping inner text", () => {
    const html = `<div><span>Keep <strong>this</strong> text</span></div>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("Keep this text");
  });

  it("normalizes whitespace", () => {
    const html = `<p>Line 1</p>\n\n\n\n<p>Line 2</p>    extra`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("Line 1\n\nLine 2 extra");
    expect(result.markdown).not.toContain("\n\n\n");
    expect(result.markdown).not.toContain("    extra");
  });

  it("returns empty title when <title> is missing", () => {
    const html = `<html><body><p>Hello</p></body></html>`;
    const result = extractMarkdown(html);
    expect(result.title).toBe("");
  });

  it("uses default maxChars of 50000", () => {
    const longText = "a".repeat(60_000);
    const html = `<p>${longText}</p>`;
    const result = extractMarkdown(html);
    expect(result.markdown.length).toBeLessThanOrEqual(50_100);
    expect(result.markdown).toContain("[...content truncated...]");
  });

  it("returns empty result for empty string input", () => {
    const result = extractMarkdown("");
    expect(result.title).toBe("");
    expect(result.markdown).toBe("");
  });

  it("handles malformed HTML without crashing", () => {
    const html = `<p>unclosed paragraph <div>nested`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("unclosed paragraph nested");
  });

  it("preserves HTML entities in output", () => {
    const html = `<p>Use &lt;div&gt; and &amp;amp;</p>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("Use &lt;div&gt; and &amp;amp;");
  });

  it("preserves indentation inside fenced code blocks", () => {
    const html = `<pre><code>function example() {
    if (true) {
        return 42;
    }
}</code></pre>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain(
      "```\nfunction example() {\n    if (true) {\n        return 42;\n    }\n}\n```",
    );
  });

  it("converts anchor with nested tags to markdown", () => {
    const html = `<a href="https://example.com"><strong>bold</strong></a>`;
    const result = extractMarkdown(html);
    expect(result.markdown).toContain("[bold](https://example.com)");
  });

  it("throws when HTML exceeds 1MB", () => {
    const hugeHtml = "a".repeat(1_000_001);
    expect(() => extractMarkdown(hugeHtml)).toThrow(
      "HTML content too large: 1000001 chars (max 1MB)",
    );
  });
});

describe("stripHtmlTags", () => {
  it("removes all HTML tags", () => {
    expect(stripHtmlTags("<div>Hello <strong>world</strong></div>")).toBe("Hello world");
  });

  it("returns plain text unchanged", () => {
    expect(stripHtmlTags("No tags here")).toBe("No tags here");
  });
});
