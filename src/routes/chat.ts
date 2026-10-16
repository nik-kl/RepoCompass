// src/routes/chat.ts
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../config.js";
import { copilotAuth } from "../middleware/copilotAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { buildMessages } from "../prompts/systemPrompt.js";
import { extractMermaidBlock, stripFencedBlocks } from "../prompts/formatters.js";
import { validateMermaidBlock } from "../prompts/mermaidGuide.js";
import type { ChatMessage } from "../types/copilot.js";
import { CopilotLlmClient, type LlmClient } from "../services/copilot/llmClient.js";
import { MockLlmClient } from "../services/copilot/mockLlm.js";
import { SSE_HEADERS, chunksToSseStream, textToChunks } from "../services/copilot/streamResponse.js";
import { detectRepository, gatherRepoContext, type RepoTarget } from "../services/github/repoContext.js";

const requestSchema = z.object({
  model: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.union([z.string(), z.array(z.unknown())]),
        copilot_references: z.unknown().optional(),
      }),
    )
    .min(1),
});

export interface OrchestratorDeps {
  llm: LlmClient;
}

export function defaultDeps(): OrchestratorDeps {
  const llm: LlmClient =
    env.LLM_PROVIDER === "mock" ? new MockLlmClient() : new CopilotLlmClient({ baseUrl: env.COPILOT_LLM_BASE_URL });
  return { llm };
}

const REPAIR_PROMPT =
  "The Mermaid block you emitted failed validation. Re-emit ONLY the corrected ```mermaid block " +
  "with alphanumeric node IDs, quoted edge labels, and no other prose.";

const MAX_QUERY_CHARS = 4_000;

export async function processChatQuery(
  query: string,
  token: string,
  target: RepoTarget | null,
  deps: OrchestratorDeps,
  model?: string,
): Promise<ReadableStream<Uint8Array>> {
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`Query too long (max ${MAX_QUERY_CHARS} characters)`);
  }

  if (!target) {
    const helpMsg =
      "👋 **Welcome to RepoCompass!**\n\nI couldn't automatically detect which repository you're asking about. " +
      "Please either:\n1. Open a repository on GitHub.com or in VS Code before chatting with `@repocompass`, or\n" +
      "2. Mention the repository name directly in your message (e.g., `@repocompass explain owner/repo`).";
    return chunksToSseStream(textToChunks(helpMsg, model ?? env.COPILOT_MODEL));
  }

  const { repoMap, chunks } = await gatherRepoContext(target, query, env.RAG_TOP_K);

  const messages: ChatMessage[] = buildMessages(
    { repository: `${target.owner}/${target.repo}`, repoMap },
    chunks,
    query,
  );

  const chosenModel = model ?? env.COPILOT_MODEL;
  const completion = await deps.llm.complete(messages, {
    token,
    model: chosenModel,
    temperature: 0.2,
  });

  let finalText = completion;
  const mermaid = extractMermaidBlock(completion);
  if (mermaid && env.MERMAID_REPAIR) {
    const validation = validateMermaidBlock(mermaid);
    if (!validation.valid) {
      const repaired = await deps.llm.complete(
        [
          ...messages,
          { role: "assistant", content: completion },
          { role: "user", content: `${REPAIR_PROMPT}\n\nErrors:${validation.errors.join("; ")}` },
        ],
        { token, model: chosenModel, temperature: 0 },
      );
      const repairedBlock = extractMermaidBlock(repaired);
      if (repairedBlock && validateMermaidBlock(repairedBlock).valid) {
        finalText = `${stripFencedBlocks(completion)}\n\n\`\`\`mermaid\n${repairedBlock}\n\`\`\``;
      } else {
        finalText = stripFencedBlocks(completion);
      }
    }
  }

  return chunksToSseStream(textToChunks(finalText, chosenModel));
}

export function createChatRoutes(deps: OrchestratorDeps = defaultDeps()): Hono {
  const routes = new Hono();

  routes.post("/chat", rateLimit(), copilotAuth, async (c) => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request body: messages[] required" }, 400);
    }

    const userMessages = parsed.data.messages.filter((m) => m.role === "user");
    const last = userMessages[userMessages.length - 1];
    const query = typeof last?.content === "string" ? last.content.trim() : "Give me an architecture overview and onboarding guide for this repository.";

    const authHeader = c.req.header("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    const target = detectRepository(parsed.data.messages, env.REPO_NAME);

    try {
      const stream = await processChatQuery(query, token, target, deps, parsed.data.model);
      return new Response(stream, { status: 200, headers: SSE_HEADERS });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Query too long")) {
        return c.json({ error: error.message }, 400);
      }
      console.error("[chat] pipeline error:", error);
      return c.json({ error: "Pipeline failure" }, 502);
    }
  });

  return routes;
}

export const chatRoutes = createChatRoutes();
