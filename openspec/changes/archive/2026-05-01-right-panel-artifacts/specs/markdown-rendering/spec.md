## ADDED Requirements

### Requirement: MarkdownRenderer renders full GFM
The `MarkdownRenderer` component SHALL render GitHub-Flavored Markdown including: headings (h1-h6), paragraphs, bold, italic, code blocks with syntax hints, inline code, tables, unordered and ordered lists, blockquotes, links, horizontal rules, and strikethrough.
The component SHALL use `react-markdown` with `remark-gfm` plugin.

#### Scenario: Headings render correctly
- **WHEN** markdown contains `# h1`, `## h2`, `### h3`
- **THEN** they render as styled heading elements with correct hierarchy

#### Scenario: Tables render
- **WHEN** markdown contains a GFM table
- **THEN** it renders as an HTML table with borders and header styling

#### Scenario: Code blocks render
- **WHEN** markdown contains fenced code blocks
- **THEN** they render in a monospace block with background and optional syntax indication

### Requirement: Assistant messages render as markdown
The `MessageList` component SHALL render assistant-role messages using `MarkdownRenderer`.
User-role messages SHALL remain plain text.

#### Scenario: Assistant message renders markdown
- **WHEN** message list displays an assistant message with markdown content
- **THEN** it renders as formatted markdown (not raw text)

#### Scenario: User message stays plain text
- **WHEN** message list displays a user message
- **THEN** it renders as plain text with `white-space: pre-wrap`

### Requirement: MarkdownRenderer handles edge cases safely
The component SHALL NOT crash on empty strings, malformed markdown, or extremely long content.

#### Scenario: Empty content
- **WHEN** markdown content is empty string
- **THEN** component renders nothing (no error)

#### Scenario: Malformed markdown
- **WHEN** markdown content has unclosed tags or broken syntax
- **THEN** component renders best-effort without crashing

### Requirement: Artifact viewer uses MarkdownRenderer
The artifact viewer component SHALL use `MarkdownRenderer` to display artifact file content.

#### Scenario: Artifact displays formatted
- **WHEN** artifact content is loaded
- **THEN** it renders through MarkdownRenderer as formatted markdown
