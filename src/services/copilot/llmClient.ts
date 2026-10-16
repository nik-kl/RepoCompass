import type { ChatCompletionChunk, ChatMessage } from "../../types/copilot.js";

export interface CompletionOptions {
  /** Bearer token forwarded from the incoming Copilot request. */
  token: string;
  model: string;
  temperature?: number;
}

export interface LlmClient {
  /** Non-streaming completion (used for the Mermaid repair pass). */
  complete(messages: ChatMessage[], options: CompletionOptions): Promise<string>;
  /** Streaming completion against the Copilot API. */
  stream(messages: ChatMessage[], options: CompletionOptions): Promise<Response>;
}

export interface CopilotLlmOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.githubcopilot.com";

/**
 * Client for the GitHub Copilot Extension LLM API
 * (Phase 5 – services/copilot/llmClient.ts).
 *
 * The extension forwards the JWT it received on the chat request as the
 * bearer token; GitHub exchanges it for model access server-side.
 */
export class CopilotLlmClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CopilotLlmOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async post(
    messages: ChatMessage[],
    options: CompletionOptions,
    stream: boolean,
  ): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        accept: stream ? "text/event-stream" : "application/json",
        "editor-version": "vscode/1.95.0",
        "editor-plugin-version": "copilot-chat/0.22.0",
        "openai-intent": "conversation-panel",
        "user-agent": "RepoCompass",
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        stream,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Copilot API ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response;
  }

  async stream(messages: ChatMessage[], options: CompletionOptions): Promise<Response> {
    return this.post(messages, options, true);
  }

  async complete(messages: ChatMessage[], options: CompletionOptions): Promise<string> {
    const response = await this.post(messages, options, false);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

/**
 * Parses an upstream SSE body into chat.completion.chunk objects.
 * Tolerates multi-line `data:` fields and ignores comments/keep-alives.
 */
export async function* parseSseChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatCompletionChunk> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  const drain = function* (flush: boolean): Generator<ChatCompletionChunk> {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch {
          // Ignore malformed keep-alive/comment frames.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (flush && buffer.trim().length > 0) {
      const data = buffer
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      buffer = "";
      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch {
          /* trailing partial frame */
        }
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
    buffer += decoder.decode();
    yield* drain(true);
  } finally {
    reader.releaseLock();
  }
}

/** Concatenates streamed deltas into the final assistant text. */
export function collectDeltaText(chunks: AsyncIterable<ChatCompletionChunk>): Promise<string> {
  return (async () => {
    let text = "";
    for await (const chunk of chunks) {
      text += chunk.choices?.[0]?.delta?.content ?? "";
    }
    return text;
  })();
}