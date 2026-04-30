export interface ExtractOptions {
  maxChars?: number;
}

export interface ExtractResult {
  title: string;
  markdown: string;
}

export function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]+>/g, "");
}

export function extractMarkdown(html: string, opts?: ExtractOptions): ExtractResult {
  if (html.length > 1_000_000) {
    throw new Error(`HTML content too large: ${html.length} chars (max 1MB)`);
  }

  const maxChars = opts?.maxChars ?? 50_000;
  const marker = "[...content truncated...]";

  // Strip script, style, nav, header, footer, and aside blocks entirely
  let cleaned = html.replace(/<(script|style|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // Extract title
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : "";

  // Extract meta description
  const descMatch =
    cleaned.match(
      /<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i,
    ) ||
    cleaned.match(
      /<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i,
    );
  const description = descMatch ? descMatch[1].trim() : "";

  // Remove title and meta tags so they are not processed as body text
  cleaned = cleaned.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, " ");
  cleaned = cleaned.replace(/<meta[^>]*>/gi, " ");

  // Convert pre>code blocks to fenced code blocks
  cleaned = cleaned.replace(
    /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    "```\n$1\n```",
  );

  // Convert headings
  cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1");
  cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1");
  cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1");
  cleaned = cleaned.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1");
  cleaned = cleaned.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1");
  cleaned = cleaned.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1");

  // Convert list items
  cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1");
  cleaned = cleaned.replace(/<\/?(?:ul|ol)[^>]*>/gi, " ");

  // Convert links
  cleaned = cleaned.replace(
    /<a[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    "[$2]($1)",
  );

  // Convert inline code
  cleaned = cleaned.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Convert paragraphs: add blank line only when followed by another block element
  cleaned = cleaned.replace(
    /<\/p>(\s*)(?=<(?:p|h[1-6]|ul|ol|pre|div|section|article|blockquote|hr|table))/gi,
    "$1\n\n",
  );
  cleaned = cleaned.replace(/<\/?p[^>]*>/gi, " ");

  // Strip any remaining HTML tags
  let markdown = stripHtmlTags(cleaned);

  // Prepend meta description if present
  if (description) {
    markdown = `> Description: ${description}\n\n${markdown}`;
  }

  // Extract fenced code blocks before whitespace normalization
  const codeBlocks: string[] = [];
  markdown = markdown.replace(/```[\s\S]*?```/g, (match) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return placeholder;
  });

  // Normalize whitespace
  markdown = markdown.replace(/[ \t]*\n[ \t]*/g, "\n");
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.replace(/[ \t]+/g, " ");

  // Restore fenced code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    markdown = markdown.replaceAll(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  markdown = markdown.trim();

  // Truncate if necessary
  if (markdown.length > maxChars) {
    const truncateAt = Math.max(0, maxChars - marker.length);
    markdown = markdown.slice(0, truncateAt) + marker;
  }

  return { title, markdown };
}
