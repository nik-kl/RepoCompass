import type { ChatCompletionChunk } from "../../types/copilot.js";

/** Headers required for a Copilot-compliant SSE response. */
export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

const encoder = new TextEncoder();

/** Wraps plain text into OpenAI-style chat.completion.chunk objects. */
export function textToChunks(text: string, model: string): ChatCompletionChunk[] {
  const id = `chatcmpl-repocompass-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const base = { id, object: "chat.completion.chunk" as const, created, model };

  // Stream line-by-line so Copilot renders progressively.
  const lines = text.length > 0 ? text.split(/(?<=\n)/) : [];
  const chunks: ChatCompletionChunk[] = lines.map((line, index) => ({
    ...base,
    choices: [{ index, delta: { content: line }, finish_reason: null }],
  }));
  chunks.push({
    ...base,
    choices: [{ index: lines.length, delta: {}, finish_reason: "stop" }],
  });
  return chunks;
}

/** Serializes chunks as SSE frames terminated by `data: [DONE]`. */
export function chunksToSseStream(
  chunks: ChatCompletionChunk[],
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/** Reads a full SSE stream back into text (used by tests and the repair loop). */
export async function readSseText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data && data !== "[DONE]") {
        try {
          const chunk = JSON.parse(data) as ChatCompletionChunk;
          text += chunk.choices?.[0]?.delta?.content ?? "";
        } catch {
          /* ignore */
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  return text;
}