import { describe, expect, it } from "vitest";
import {
  SSE_HEADERS,
  chunksToSseStream,
  readSseText,
  textToChunks,
} from "../../src/services/copilot/streamResponse.js";
import type { ChatCompletionChunk } from "../../src/types/copilot.js";

describe("textToChunks", () => {
  it("splits text into content deltas plus a final stop chunk", () => {
    const chunks = textToChunks("line one\nline two\n", "gpt-4o");
    const contents = chunks.map((c) => c.choices[0]!.delta.content ?? "");
    expect(contents.join("")).toBe("line one\nline two\n");
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe("stop");
    expect(chunks.every((c) => c.object === "chat.completion.chunk" && c.model === "gpt-4o")).toBe(true);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(1);
  });

  it("handles empty text with just the stop frame", () => {
    const chunks = textToChunks("", "m");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.choices[0]!.finish_reason).toBe("stop");
  });
});

describe("chunksToSseStream", () => {
  it("emits data frames terminated by [DONE]", async () => {
    const chunks: ChatCompletionChunk[] = textToChunks("hello world", "m");
    const raw = await readSseText(chunksToSseStream(chunks));
    expect(raw).toBe("hello world");
  });

  it("produces byte-accurate SSE framing", async () => {
    const stream = chunksToSseStream(textToChunks("hi", "m"));
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }
    expect(raw.startsWith("data: ")).toBe(true);
    expect(raw.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(raw.match(/\n\n/g)).toHaveLength(raw.split("data:").length - 1);
  });
});

describe("SSE_HEADERS", () => {
  it("declares a no-buffer event stream", () => {
    expect(SSE_HEADERS["content-type"]).toContain("text/event-stream");
    expect(SSE_HEADERS["cache-control"]).toContain("no-transform");
    expect(SSE_HEADERS["x-accel-buffering"]).toBe("no");
  });
});