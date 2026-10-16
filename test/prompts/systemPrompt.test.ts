import { describe, expect, it } from "vitest";
import { buildContextBlock, buildMessages, buildSystemPrompt } from "../../src/prompts/systemPrompt.js";
import type { ContextChunk } from "../../src/prompts/systemPrompt.js";

const chunks: ContextChunk[] = [
  {
    filePath: "src/auth/login.ts",
    symbolName: "loginUser",
    parentSymbol: null,
    startLine: 12,
    endLine: 30,
    content: "export function loginUser(creds) { /* ... */ }",
  },
  {
    filePath: "src/auth/session.ts",
    symbolName: "start",
    parentSymbol: "Session",
    startLine: 4,
    endLine: 9,
    content: "start() { /* ... */ }",
  },
];

describe("buildSystemPrompt", () => {
  it("includes role, repository, grounding rules, and the Mermaid contract", () => {
    const prompt = buildSystemPrompt({ repository: "acme/widgets" });
    expect(prompt).toContain("RepoCompass");
    expect(prompt).toContain("acme/widgets");
    expect(prompt).toContain("never invent");
    expect(prompt).toContain("```mermaid");
    expect(prompt).toContain("alphanumeric");
    expect(prompt).toContain("flowchart TD");
  });

  it("includes the repo map when provided", () => {
    const prompt = buildSystemPrompt({ repository: "r", repoMap: "src/ -> services" });
    expect(prompt).toContain("src/ -> services");
  });
});

describe("buildContextBlock", () => {
  it("labels each chunk with path, symbol, and line range", () => {
    const block = buildContextBlock(chunks);
    expect(block).toContain("src/auth/login.ts :: loginUser (src/auth/login.ts:12-30)");
    expect(block).toContain("src/auth/session.ts :: Session.start (src/auth/session.ts:4-9)");
    expect(block).toContain("use only this code");
  });

  it("handles empty retrieval", () => {
    expect(buildContextBlock([])).toContain("no matching code");
  });
});

describe("buildMessages", () => {
  it("produces system + user turns with the query appended", () => {
    const messages = buildMessages({ repository: "r" }, chunks, "How does login work?");
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Developer question: How does login work?");
    expect(messages[1]!.content).toContain("loginUser");
  });
});