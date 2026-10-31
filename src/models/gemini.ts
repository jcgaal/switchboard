import { httpError, missingKey, serverSentEvents } from "./http";
import {
  ModelError,
  type CompleteRequest,
  type Fetch,
  type ModelAdapter,
  type StreamRequest,
  type Turn,
  type Usage,
} from "./types";

type Options = { apiKey?: string; baseUrl?: string; fetch?: Fetch };

type Chunk = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

const textOf = (chunk: Chunk) =>
  (chunk.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");

// Thinking tokens are billed as output, so they are counted
// with reply tokens, which keeps the meter close to what
// the provider charges for each request during calls.
const usageOf = (metadata: Chunk["usageMetadata"]): Usage | undefined =>
  metadata
    ? {
        inputTokens: metadata.promptTokenCount ?? 0,
        outputTokens: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
      }
    : undefined;

export function geminiAdapter(model: string, options: Options): ModelAdapter {
  const baseUrl = (options.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/,
    "",
  );
  const fetcher = options.fetch ?? fetch;

  async function post(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (!options.apiKey) throw missingKey("GEMINI_API_KEY");
    const response = await fetcher(`${baseUrl}/models/${encodeURIComponent(model)}:${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await httpError(response, "gemini");
    return response;
  }

  const request = (system: string, turns: Turn[], maxTokens: number) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    generationConfig: { maxOutputTokens: maxTokens },
  });

  return {
    id: `gemini:${model}`,

    async *stream({ system, messages, maxTokens, signal }: StreamRequest) {
      const response = await post(
        "streamGenerateContent?alt=sse",
        request(system, messages, maxTokens),
        signal,
      );
      for await (const raw of serverSentEvents(response)) {
        const chunk = raw as Chunk;
        const text = textOf(chunk);
        if (text) yield { text };
        const usage = usageOf(chunk.usageMetadata);
        if (usage) yield { usage };
      }
    },

    async complete({ system, prompt, maxTokens, signal }: CompleteRequest) {
      const response = await post(
        "generateContent",
        request(system, [{ role: "user", content: prompt }], maxTokens),
        signal,
      );
      const result = (await response.json()) as Chunk;
      if (result.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        throw new ModelError(null, "max_tokens", "Response stopped at the token limit");
      }
      return { text: textOf(result), usage: usageOf(result.usageMetadata) };
    },
  };
}
