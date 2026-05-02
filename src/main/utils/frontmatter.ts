import { parse } from "yaml";

export interface FrontmatterMeta {
  name?: string;
  description?: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns an empty object if no frontmatter block is found or parsing fails.
 */
export function parseFrontmatter(content: string): FrontmatterMeta {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!match) return {};
  try {
    return (parse(match[1]) as FrontmatterMeta) ?? {};
  } catch {
    return {};
  }
}
