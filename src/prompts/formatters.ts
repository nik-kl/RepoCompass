/**
 * Response formatters for Copilot chat output (Phase 5 – prompts/formatters.ts).
 * All code and diagram output passes through here so citations stay uniform.
 */

/** Renders a fenced code block with language + path:line citation. */
export function formatCodeBlock(language: string, path: string, code: string, range?: [number, number]): string {
  const location = range ? `${path}:${range[0]}-${range[1]}` : path;
  return `\`\`\`${language} ${location}\n${code.trimEnd()}\n\`\`\``;
}

/** Renders a Mermaid diagram block (content must already be validated). */
export function formatMermaidBlock(diagramCode: string): string {
  return `\`\`\`mermaid\n${diagramCode.trim()}\n\`\`\``;
}

/** Extracts every fenced block from a model response, in order. */
export function extractFencedBlocks(markdown: string): Array<{ tag: string; content: string }> {
  const blocks: Array<{ tag: string; content: string }> = [];
  // Info strings may carry attributes (```typescript src/a.ts:12-30) — the tag
  // is the first token; the rest is citation metadata.
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(pattern)) {
    const info = (match[1] ?? "").trim();
    const tag = (info.split(/\s+/)[0] ?? "").toLowerCase();
    blocks.push({ tag, content: match[2]!.trimEnd() });
  }
  return blocks;
}

/** Returns the first mermaid block's code, or null when none exists. */
export function extractMermaidBlock(markdown: string): string | null {
  return extractFencedBlocks(markdown).find((block) => block.tag === "mermaid")?.content ?? null;
}

/** Strips fenced blocks from text (used when a diagram must be dropped). */
export function stripFencedBlocks(markdown: string): string {
  return markdown.replace(/```[^\n`]*\n[\s\S]*?```/g, "").trim();
}

/** Escapes text for safe inclusion inside a Mermaid quoted label. */
export function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()|#]/g, "");
}