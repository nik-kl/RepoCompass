/**
 * Mermaid.js output contract injected into the system prompt
 * (Phase 5 – prompts/mermaidGuide.ts).
 *
 * The rules are deliberately mechanical so the model can follow them
 * deterministically; `validateMermaidBlock` enforces them server-side.
 */

export const MERMAID_GUIDE = `
## Mermaid diagram rules (mandatory)

When a diagram helps, emit it in a fenced block tagged exactly \`\`\`mermaid and nothing else around the fence.

Allowed diagram types (use only these):
- \`flowchart TD\` for architecture / data flow
- \`sequenceDiagram\` for request/response flows
- \`classDiagram\` for type relationships

Hard syntax rules:
1. Node IDs must be alphanumeric: ASCII letters, digits, and underscore only — no hyphens, spaces, or dots. Example: \`authService\`, never \`auth-service\`.
2. Every edge label must be quoted: \`A -->|"calls"| B\`.
3. Node labels with spaces or punctuation must be quoted: \`authService["Auth Service"]\`.
4. Never nest or place backticks inside a diagram block.
5. Never invent files, symbols, or endpoints — every node must come from the provided repository context.
6. One diagram per block; at most one diagram per answer unless the user asks for more.
7. If you cannot ground a diagram in the provided context, answer in prose instead of guessing.

Correct example:
\`\`\`mermaid
flowchart TD
  chatRoute["POST /v1/chat"] -->|"embeds query"| retriever["RAG Retriever"]
  retriever -->|"top-k chunks"| assembler["Prompt Assembler"]
  assembler -->|"streams SSE"| llm["Copilot LLM"]
\`\`\`

Incorrect (do NOT emit): \`auth-service -->|"calls"| db\` — hyphens in IDs are invalid.
`.trim();

const ALLOWED_DIAGRAM_TYPES = new Set(["flowchart", "sequenceDiagram", "classDiagram"]);
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface MermaidValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Server-side lint of an emitted Mermaid block: validates the diagram type,
 * node IDs, and quoted edge labels before the block reaches the user.
 * Used by the repair loop in the orchestrator.
 */
export function validateMermaidBlock(code: string): MermaidValidation {
  const errors: string[] = [];
  const lines = code.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { valid: false, errors: ["empty diagram"] };
  }

  const first = lines[0]!;
  const type = first.split(/\s+/)[0] ?? "";
  if (!ALLOWED_DIAGRAM_TYPES.has(type)) {
    errors.push(`unsupported diagram type '${type}' (allowed: ${[...ALLOWED_DIAGRAM_TYPES].join(", ")})`);
  }

  for (const line of lines.slice(1)) {
    if (line.includes("`")) errors.push(`backtick inside diagram: ${line}`);
    if (line.startsWith("%%")) continue; // comments are fine

    // Edges: A -->|"label"| B  /  A -->|calls| B  /  A ->> B
    // Node tokens deliberately allow invalid characters so ID_PATTERN can
    // flag them (e.g. hyphenated `auth-service`).
    const edge = line.match(
      /^([A-Za-z0-9_.-]+)\s*[-.=]+>{1,2}\s*(?:\|([^|]*)\|\s*)?([A-Za-z0-9_.-]+)/,
    );
    if (edge) {
      const [, source, label, target] = edge;
      if (!ID_PATTERN.test(source!)) errors.push(`invalid node id '${source}'`);
      if (!ID_PATTERN.test(target!)) errors.push(`invalid node id '${target}'`);
      if (label !== undefined && !(label.startsWith('"') && label.endsWith('"'))) {
        errors.push(`unquoted edge label: ${line}`);
      }
      continue;
    }

    // Node definitions: id["label"] / id("label")
    const definition = line.match(/^([A-Za-z0-9_.-]+)\s*[\[(]/);
    if (definition && !ID_PATTERN.test(definition[1]!)) {
      errors.push(`invalid node id '${definition[1]}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}