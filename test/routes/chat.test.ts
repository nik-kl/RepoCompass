import { describe, expect, it } from "vitest";
import { createChatRoutes, processChatQuery, type OrchestratorDeps } from "../../src/routes/chat.js";
import { HnswVectorStore } from "../../src/services/rag/vectorStore.js";
import type { ChunkMetadata } from "../../src/services/rag/indexer.js";
import type { EmbeddingProvider } from "../../src/services/rag/embedder.js";
import type { LlmClient } from "../../src/services/copilot/llmClient.js";
import type { ChatMessage } from "../../src/types/copilot.js";
import { readSseText } from "../../src/services/copilot/streamResponse.js";

const fakeEmbedder: EmbeddingProvider = {
  name: "fake",
  dimensions: 8,
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array(8).fill(0);
      for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
        vector[word.charCodeAt(0) % 8] += 1;
      }
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
      return vector.map((v) => v / norm);
    });
  },
};

interface FakeLlmOptions {
  responses: string[];
}

function fakeLlm(options: FakeLlmOptions): LlmClient & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  let cursor = 0;
  return {
    calls,
    async complete(messages: ChatMessage[]): Promise<string> {
      calls.push(messages);
      const response = options.responses[Math.min(cursor, options.responses.length - 1)]!;
      cursor += 1;
      return response;
    },
    async stream(): Promise<Response> {
      throw new Error("stream not used in tests");
    },
  };
}

async function seededDeps(responses: string[]): Promise<OrchestratorDeps & { llm: ReturnType<typeof fakeLlm> }> {
  const store = new HnswVectorStore<ChunkMetadata>({ dimensions: 8, embedder: fakeEmbedder });
  await store.embedAndAdd([
    {
      id: "src/auth.ts:1-5",
      text: "export function loginUser() { return true; }",
      metadata: {
        filePath: "src/auth.ts",
        symbolName: "loginUser",
        parentSymbol: null,
        startLine: 1,
        endLine: 5,
        content: "export function loginUser() { return true; }",
      },
    },
    {
      id: "src/garden.ts:1-3",
      text: "export function plantTomatoes() {}",
      metadata: {
        filePath: "src/garden.ts",
        symbolName: "plantTomatoes",
        parentSymbol: null,
        startLine: 1,
        endLine: 3,
        content: "export function plantTomatoes() {}",
      },
    },
  ]);
  const llm = fakeLlm({ responses });
  return { embedder: fakeEmbedder, store, llm };
}

describe("processChatQuery", () => {
  it("embeds, retrieves, assembles prompt, and streams SSE", async () => {
    const deps = await seededDeps(["Login is handled by loginUser."]);
    const stream = await processChatQuery("how does login work?", "jwt", deps);
    const text = await readSseText(stream);

    expect(text).toBe("Login is handled by loginUser.");
    expect(deps.llm.calls).toHaveLength(1);

    const [system, user] = deps.llm.calls[0]!;
    expect(system.role).toBe("system");
    expect(system.content).toContain("RepoCompass");
    expect(system.content).toContain("```mermaid");
    expect(user.content).toContain("src/auth.ts :: loginUser"); // top-1 retrieval
    expect(user.content).not.toContain("plantTomatoes"); // irrelevant chunk filtered out
    expect(user.content).toContain("Developer question: how does login work?");
  });

  it("repairs an invalid Mermaid block via a second completion", async () => {
    const broken = "Here you go:\n```mermaid\nflowchart TD\n  auth-service -->|calls| db\n```";
    const fixed = "```mermaid\nflowchart TD\n  authService -->|\"calls\"| db\n```";
    const deps = await seededDeps([broken, fixed]);

    const text = await readSseText(await processChatQuery("diagram please", "jwt", deps));
    expect(deps.llm.calls).toHaveLength(2); // original + repair
    expect(deps.llm.calls[1]!.at(-1)!.content).toContain("failed validation");
    expect(text).toContain('authService -->|"calls"| db');
    expect(text).not.toContain("auth-service");
  });

  it("drops the diagram when repair also fails", async () => {
    const broken = "```mermaid\nflowchart TD\n  auth-service -->|calls| db\n```";
    const stillBroken = "```mermaid\nflowchart TD\n  another-bad -->|nope| x\n```";
    const deps = await seededDeps([broken, stillBroken]);

    const text = await readSseText(await processChatQuery("diagram please", "jwt", deps));
    expect(text).not.toContain("```mermaid");
    expect(text).not.toContain("auth-service");
  });

  it("rejects oversized queries before any embedding work", async () => {
    const deps = await seededDeps(["never called"]);
    await expect(processChatQuery("x".repeat(4_001), "jwt", deps)).rejects.toThrow(/too long/i);
    expect(deps.llm.calls).toHaveLength(0);
  });
});

describe("POST /v1/chat route", () => {
  it("rejects requests without a bearer token", async () => {
    const deps = await seededDeps(["ok"]);
    const app = createChatRoutes(deps);
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid tokens before body validation", async () => {
    const deps = await seededDeps(["ok"]);
    const app = createChatRoutes(deps);
    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-real-jwt",
      },
      body: JSON.stringify({ messages: [] }),
    });
    // Auth runs first: an invalid token is rejected before body validation.
    expect(res.status).toBe(401);
  });
});