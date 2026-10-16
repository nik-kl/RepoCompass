import { describe, expect, it } from "vitest";
import { validateMermaidBlock } from "../../src/prompts/mermaidGuide.js";

const VALID = `flowchart TD
  chatRoute["POST /v1/chat"] -->|"embeds query"| retriever["RAG Retriever"]
  retriever -->|"top-k chunks"| assembler["Prompt Assembler"]`;

describe("validateMermaidBlock", () => {
  it("accepts a well-formed flowchart", () => {
    expect(validateMermaidBlock(VALID)).toEqual({ valid: true, errors: [] });
  });

  it("accepts sequence and class diagrams", () => {
    expect(validateMermaidBlock('sequenceDiagram\n  A->>B: "hello"').valid).toBe(true);
    expect(validateMermaidBlock("classDiagram\n  RepoCompass *-- Chunk").valid).toBe(true);
  });

  it("rejects unsupported diagram types", () => {
    const result = validateMermaidBlock("gantt\n  title plan");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unsupported diagram type/);
  });

  it("rejects hyphenated node IDs", () => {
    const result = validateMermaidBlock('flowchart TD\n  auth-service -->|"calls"| db');
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/invalid node id/);
  });

  it("rejects unquoted edge labels", () => {
    const result = validateMermaidBlock("flowchart TD\n  A -->|calls| B");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/unquoted edge label/);
  });

  it("rejects backticks inside diagrams", () => {
    const result = validateMermaidBlock('flowchart TD\n  A["has `tick`"] --> B');
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/backtick/);
  });

  it("rejects empty input", () => {
    expect(validateMermaidBlock("   \n  ").valid).toBe(false);
  });
});