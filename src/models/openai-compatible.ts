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

type Options = {
  prefix: "openai" | "openai-compatible";
  apiKey?: string;
  baseUrl?: string;
  fetch?: Fetch;
};

type Chunk = {
  choices?: {
    delta?: { content?: string | null };
    message?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

const usageOf = (usage: Chunk["usage"]): Usage | undefined =>
  usage
    ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 }
    : undefined;

// One adapter covers OpenAI and every server that copies its
// Chat Completions API. Some local servers skip the usage
// block, and then the dashboard usage meter shows n/a.
export function openaiCompatibleAdapter(model: string, options: Options): ModelAdapter {
  const official = options.prefix === "openai";
  const baseUrl = (options.baseUrl || (official ? "https://api.openai.com/v1" : "")).replace(
    /\/+$/,
    "",
  );
  const fetcher = options.fetch ?? fetch;

  async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    if (!baseUrl) throw missingKey("OPENAI_BASE_URL");
    if (official && !options.apiKey) throw missingKey("OPENAI_API_KEY");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    const response = await fetcher(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, ...body }),
      signal,
    });
    if (!response.ok) throw await httpError(response, options.prefix);
    return response;
  }

  // OpenAI's own models take max_completion_tokens, while most
  // compatible servers only accept the older field name, so
  // the field follows the kind of endpoint that is used.
  const limit = (maxTokens: number) =>
    official ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  const messages = (system: string, turns: Turn[]) => [
    { role: "system", content: system },
    ...turns,
  ];

  return {
    id: `${options.prefix}:${model}`,

    async *stream({ system, messages: turns, maxTokens, signal }: StreamRequest) {
      const response = await post(
        {
          ...limit(maxTokens),
          messages: messages(system, turns),
          stream: true,
          stream_options: { include_usage: true },
        },
        signal,
      );
      for await (const raw of serverSentEvents(response)) {
        const chunk = raw as Chunk;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { text };
        const usage = usageOf(chunk.usage);
        if (usage) yield { usage };
      }
    },

    async complete({ system, prompt, maxTokens, signal }: CompleteRequest) {
      const response = await post(
        {
          ...limit(maxTokens),
          messages: messages(system, [{ role: "user", content: prompt }]),
        },
        signal,
      );
      const result = (await response.json()) as Chunk;
      const choice = result.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new ModelError(null, "max_tokens", "Response stopped at the token limit");
      }
      return { text: choice?.message?.content ?? "", usage: usageOf(result.usage) };
    },
  };
}
