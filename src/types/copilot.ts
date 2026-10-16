/** OpenAI-compatible message shape used by the Copilot Extension API. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Incoming Copilot chat request body (subset we consume). */
export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  [key: string]: unknown;
}

/** SSE chunk emitted back to Copilot (OpenAI chat.completion.chunk shape). */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}