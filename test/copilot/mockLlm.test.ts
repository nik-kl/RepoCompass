import { describe, expect, it } from "vitest";
import { MockLlmClient } from "../../src/services/copilot/mockLlm.js";
import { validateMermaidBlock } from "../../src/prompts/mermaidGuide.js";
import { buildMessages } from "../../src/prompts/systemPrompt.js";

describe("MockLlmClient", () => {
  const client = new MockLlmClient();

  it("answers from the retrieved context block", async () => {
    const messages = buildMessages(
      { repository: "acme/widgets" },
      [
        {
          filePath: "src/auth.ts",
          symbolName: "loginUser",
          parentSymbol: null,
          startLine: 1,
          endLine: 5,
          content: "export function loginUser() {}",
        },
      ],
      "How does login work?",
    );

    const answer = await client.complete(messages);
    expect(answer).toContain("demo mode");
    expect(answer).toContain("src/auth.ts :: loginUser");
    expect(answer).toContain("How does login work?");
  });

  it("emits a spec-valid Mermaid diagram grounded in the chunks", async () => {
    const messages = buildMessages(
      { repository: "r" },
      [
        {
          filePath: "src/a.ts",
          symbolName: "alpha",
          parentSymbol: null,
          startLine: 1,
          endLine: 2,
          content: "const alpha = 1;",
        },
      ],
      "show me the architecture!",
    );

    const answer = await client.complete(messages);
    const diagram = answer.match(/```mermaid\n([\s\S]*?)```/)?.[1];
    expect(diagram).toBeDefined();
    expect(validateMermaidBlock(diagram!)).toEqual({ valid: true, errors: [] });
    expect(diagram).toContain('c0["src/a.ts :: alpha"]');
  });

  it("omits the diagram when nothing was retrieved", async () => {
    const messages = buildMessages({ repository: "r" }, [], "hello?");
    const answer = await client.complete(messages);
    expect(answer).toContain("Retrieved **0 chunks**");
    expect(answer).not.toContain("```mermaid");
  });

  it("sanitizes hostile question text inside Mermaid labels", async () => {
    const messages = buildMessages(
      { repository: "r" },
      [
        {
          filePath: "src/a.ts",
          symbolName: "alpha",
          parentSymbol: null,
          startLine: 1,
          endLine: 2,
          content: "x",
        },
      ],
      'evil -->| "break | out ] label',
    );
    const answer = await client.complete(messages);
    const diagram = answer.match(/```mermaid\n([\s\S]*?)```/)?.[1];
    expect(diagram).toBeDefined();
    expect(validateMermaidBlock(diagram!)).toEqual({ valid: true, errors: [] });
  });
});
