import { describe, expect, it } from "vitest";
import {
  CopilotLlmClient,
  collectDeltaText,
  parseSseChunks,
} from "../../src/services/copilot/llmClient.js";
import type { ChatMessage } from "../../src/types/copilot.js";

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

function sseResponse(frames: string[]): Response {
  return new Response(frames.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("CopilotLlmClient.stream", () => {
  it("POSTs to /chat/completions with Copilot headers and returns SSE", async () => {
    let captured: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const client = new CopilotLlmClient({
      baseUrl: "https://api.example.test",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        captured = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        };
        return sseResponse([
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "hey" } }] })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }) as unknown as typeof fetch,
    });

    const response = await client.stream(messages, { token: "jwt-token", model: "gpt-4o" });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(captured!.url).toBe("https://api.example.test/chat/completions");
    expect(captured!.headers.get("authorization")).toBe("Bearer jwt-token");
    expect(captured!.headers.get("editor-version")).toContain("vscode");
    expect(captured!.body).toMatchObject({ model: "gpt-4o", stream: true });

    const text = await collectDeltaText(parseSseChunks(response.body!));
    expect(text).toBe("hey");
  });

  it("throws with status detail on non-2xx responses", async () => {
    const client = new CopilotLlmClient({
      baseUrl: "https://api.example.test",
      fetchImpl: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
    });
    await expect(client.stream(messages, { token: "t", model: "m" })).rejects.toThrow(/429.*rate limited/);
  });
});

describe("CopilotLlmClient.complete", () => {
  it("returns assistant text from a non-streaming response", async () => {
    const client = new CopilotLlmClient({
      baseUrl: "https://api.example.test",
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.stream).toBe(false);
        return new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    expect(await client.complete(messages, { token: "t", model: "m" })).toBe("answer");
  });
});

describe("parseSseChunks", () => {
  it("parses frames across arbitrary chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const payload =
      `data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}\n\n` +
      `data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n` +
      "data: [DONE]\n\n";
    // Split mid-frame to exercise buffering.
    const cut = 40;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0, cut)));
        controller.enqueue(encoder.encode(payload.slice(cut)));
        controller.close();
      },
    });

    const text = await collectDeltaText(parseSseChunks(stream));
    expect(text).toBe("Hello");
  });

  it("ignores comments and malformed frames", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        controller.enqueue(encoder.encode("data: {not json}\n\n"));
        controller.enqueue(
          encoder.encode(`data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n`),
        );
        controller.close();
      },
    });
    expect(await collectDeltaText(parseSseChunks(stream))).toBe("ok");
  });
});