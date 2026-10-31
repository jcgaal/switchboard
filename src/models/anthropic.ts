import Anthropic from "@anthropic-ai/sdk";
import { missingKey } from "./http";
import {
  ModelError,
  type CompleteRequest,
  type Fetch,
  type ModelAdapter,
  type StreamRequest,
  type Usage,
} from "./types";

type Options = { apiKey?: string; fetch?: Fetch };

// The SDK error keeps the provider's body, which names the
// cause of a bad key or model. Only that body is saved,
// so headers and request data never reach any event.
function modelError(error: unknown): unknown {
  if (!(error instanceof Anthropic.APIError)) return error;
  const body = error.error as
    { error?: { type?: unknown; message?: unknown }; message?: unknown } | undefined;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return new ModelError(
    error.status ?? null,
    error.type ?? text(body?.error?.type),
    text(body?.error?.message) ??
      text(body?.message) ??
      (error.status ? "Anthropic API returned no error message" : error.message),
  );
}

export function anthropicAdapter(model: string, options: Options): ModelAdapter {
  const client = (timeout?: number) => {
    if (!options.apiKey) throw missingKey("ANTHROPIC_API_KEY");
    return new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout, fetch: options.fetch });
  };
  // No tools are used, so the small output budget goes entirely
  // to spoken text. Sonnet 5.5 requires between_tools rather
  // than disabled to obtain this behavior from the model.
  const thinking = model.startsWith("claude-sonnet-5-5")
    ? { type: "between_tools" as const }
    : undefined;

  return {
    id: `anthropic:${model}`,

    async *stream({ system, messages, maxTokens, signal }: StreamRequest) {
      try {
        const stream = client().messages.stream(
          {
            model,
            max_tokens: maxTokens,
            thinking,
            system,
            messages: messages.map((turn) => ({ ...turn })),
          },
          { signal },
        );
        let usage: Usage | undefined;
        for await (const event of stream) {
          if (event.type === "message_start") {
            usage = {
              inputTokens: event.message.usage.input_tokens,
              outputTokens: event.message.usage.output_tokens,
            };
            yield { usage };
          } else if (event.type === "message_delta" && usage) {
            usage = { ...usage, outputTokens: event.usage.output_tokens };
            yield { usage };
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { text: event.delta.text };
          }
        }
      } catch (error) {
        throw modelError(error);
      }
    },

    async complete({ system, prompt, maxTokens, signal }: CompleteRequest) {
      try {
        const result = await client(15_000).messages.create(
          {
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: prompt }],
          },
          { signal },
        );
        if (result.stop_reason === "max_tokens") {
          throw new ModelError(null, "max_tokens", "Response stopped at the token limit");
        }
        return {
          text: result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
          usage: {
            inputTokens: result.usage.input_tokens,
            outputTokens: result.usage.output_tokens,
          },
        };
      } catch (error) {
        throw modelError(error);
      }
    },
  };
}
