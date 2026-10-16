import type { ChatMessage } from "../../types/copilot.js";
import type { CompletionOptions, LlmClient } from "./llmClient.js";
import { escapeMermaidLabel } from "../../prompts/formatters.js";
import { validateMermaidBlock } from "../../prompts/mermaidGuide.js";

/**
 * Deterministic offline LLM used for demos and CI (LLM_PROVIDER=mock).
 * It exercises the real prompt-assembly path: it reads the retrieved chunks
 * from the context block and echoes them back as a grounded answer with a
 * spec-valid Mermaid diagram — no network, no credentials.
 */
export class MockLlmClient implements LlmClient {
  async complete(messages: ChatMessage[], _options?: CompletionOptions): Promise<string> {
    const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const question = (user.split("Developer question: ")[1] ?? "your question").trim();
    const labels = [...user.matchAll(/--- chunk \d+: ([^(]+) \(/g)].map((m) => m[1]!.trim());

    const lines = [
      `**RepoCompass demo mode** (mock LLM — set \`LLM_PROVIDER=copilot\` for real answers)`,
      "",
      `Retrieved **${labels.length} chunks** relevant to: "${question.slice(0, 160)}"`,
      ...labels.map((label) => `- \`${label}\``),
      "",
      "The production pipeline streams the Copilot LLM's grounded answer here, citing the paths above.",
    ];

    if (labels.length > 0) {
      const query = escapeMermaidLabel(question).slice(0, 60);
      const edges = labels
        .slice(0, 6)
        .map((label, i) => `  query["${query}"] -->|"retrieves"| c${i}["${escapeMermaidLabel(label)}"]`);
      const diagram = ["flowchart TD", ...edges].join("\n");
      if (validateMermaidBlock(diagram).valid) {
        lines.push("", "```mermaid", diagram, "```");
      }
    }

    return lines.join("\n");
  }

  async stream(): Promise<Response> {
    throw new Error("MockLlmClient does not stream; use complete()");
  }
}
