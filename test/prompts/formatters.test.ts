import { describe, expect, it } from "vitest";
import {
  escapeMermaidLabel,
  extractFencedBlocks,
  extractMermaidBlock,
  formatCodeBlock,
  formatMermaidBlock,
  stripFencedBlocks,
} from "../../src/prompts/formatters.js";

describe("formatCodeBlock", () => {
  it("renders language + path + line range", () => {
    const block = formatCodeBlock("typescript", "src/a.ts", "const x = 1;", [3, 5]);
    expect(block).toBe("```typescript src/a.ts:3-5\nconst x = 1;\n```");
  });

  it("omits the range when not provided", () => {
    expect(formatCodeBlock("python", "b.py", "pass")).toBe("```python b.py\npass\n```");
  });
});

describe("formatMermaidBlock", () => {
  it("wraps content in a mermaid fence", () => {
    expect(formatMermaidBlock("flowchart TD\n  A --> B")).toBe("```mermaid\nflowchart TD\n  A --> B\n```");
  });
});

describe("extractFencedBlocks / extractMermaidBlock", () => {
  const markdown = [
    "Here is the flow:",
    "```typescript src/a.ts:1-3",
    "const a = 1;",
    "```",
    "And a diagram:",
    "```mermaid",
    "flowchart TD",
    "  A --> B",
    "```",
    "```mermaid",
    "sequenceDiagram",
    "```",
  ].join("\n");

  it("extracts all blocks in order with tags", () => {
    const blocks = extractFencedBlocks(markdown);
    expect(blocks.map((b) => b.tag)).toEqual(["typescript", "mermaid", "mermaid"]);
    expect(blocks[0]!.content).toBe("const a = 1;");
  });

  it("returns the first mermaid block only", () => {
    expect(extractMermaidBlock(markdown)).toBe("flowchart TD\n  A --> B");
  });

  it("returns null when no mermaid block exists", () => {
    expect(extractMermaidBlock("plain text")).toBeNull();
  });
});

describe("stripFencedBlocks", () => {
  it("removes all fenced blocks, keeping prose", () => {
    const text = "Prose before\n```mermaid\nflowchart TD\n```\nProse after";
    expect(stripFencedBlocks(text)).toBe("Prose before\n\nProse after");
  });
});

describe("escapeMermaidLabel", () => {
  it("replaces quotes and strips Mermaid-structural characters", () => {
    expect(escapeMermaidLabel('say "hi" [now]')).toBe("say 'hi' now");
  });
});