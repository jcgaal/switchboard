import { describe, expect, it } from "vitest";
import {
  createAdapter,
  missingSettings,
  ModelConfigError,
  parseModel,
} from "../src/models/registry";
import { ModelError, type Fetch, type ModelAdapter } from "../src/models/types";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

// A fake fetch that records each request and answers with the given
// SSE lines. With hang set, the body stays open until the abort,
// which is how a real socket behaves when the caller cuts in.
function fakeFetch(
  lines: string[],
  options: { status?: number; json?: unknown; hang?: boolean } = {},
) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    if (options.json !== undefined) {
      return new Response(JSON.stringify(options.json), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json", "request-id": "req_test" },
      });
    }
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        if (!options.hang) return controller.close();
        signal?.addEventListener("abort", () =>
          controller.error(signal.reason ?? new Error("aborted")),
        );
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as Fetch;
  return { fetcher, calls };
}

const sse = (data: unknown, event?: string) =>
  `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

const request = (signal = new AbortController().signal) => ({
  system: "Be brief.",
  messages: [{ role: "user" as const, content: "Hello" }],
  maxTokens: 50,
  signal,
});

async function collect(adapter: ModelAdapter, signal?: AbortSignal) {
  let text = "";
  let usage;
  for await (const chunk of adapter.stream(request(signal))) {
    if (chunk.text) text += chunk.text;
    if (chunk.usage) usage = chunk.usage;
  }
  return { text, usage };
}

async function abortsPromptly(adapter: ModelAdapter) {
  const controller = new AbortController();
  const started = Date.now();
  const iterate = (async () => {
    for await (const chunk of adapter.stream(request(controller.signal))) {
      if (chunk.text) controller.abort();
    }
  })();
  await iterate.catch(() => undefined);
  expect(controller.signal.aborted).toBe(true);
  expect(Date.now() - started).toBeLessThan(1000);
}

const anthropicStream = [
  sse(
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-test",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1 },
      },
    },
    "message_start",
  ),
  sse(
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    "content_block_start",
  ),
  sse(
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "[en] Hi" } },
    "content_block_delta",
  ),
  sse(
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there." } },
    "content_block_delta",
  ),
  sse({ type: "content_block_stop", index: 0 }, "content_block_stop"),
  sse(
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 7 },
    },
    "message_delta",
  ),
  sse({ type: "message_stop" }, "message_stop"),
];

const openaiStream = [
  sse({ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }),
  sse({ choices: [{ index: 0, delta: { content: "[en] Hi" } }] }),
  sse({ choices: [{ index: 0, delta: { content: " there." }, finish_reason: "stop" }] }),
  sse({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }),
  "data: [DONE]\n\n",
];

const geminiStream = [
  sse({
    candidates: [{ content: { role: "model", parts: [{ text: "[en] Hi" }] } }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2 },
  }),
  sse({
    candidates: [
      { content: { role: "model", parts: [{ text: " there." }] }, finishReason: "STOP" },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 2 },
  }),
];

describe("registry", () => {
  it("parses provider and model id", () => {
    expect(parseModel("openai-compatible:llama3.2:3b")).toEqual({
      provider: "openai-compatible",
      model: "llama3.2:3b",
    });
  });

  it("rejects an unknown provider or a missing model id", () => {
    expect(() => parseModel("cohere:command")).toThrow(ModelConfigError);
    expect(() => parseModel("claude-sonnet-5-5")).toThrow(/provider:model-id/);
    expect(() => parseModel("anthropic:")).toThrow(/provider:model-id/);
  });

  it("names the settings each provider needs", () => {
    expect(missingSettings("anthropic:x", {})).toEqual(["ANTHROPIC_API_KEY"]);
    expect(missingSettings("openai:x", {})).toEqual(["OPENAI_API_KEY"]);
    expect(missingSettings("openai-compatible:x", {})).toEqual(["OPENAI_BASE_URL"]);
    expect(
      missingSettings("openai-compatible:x", { OPENAI_BASE_URL: "http://localhost:11434/v1" }),
    ).toEqual([]);
    expect(missingSettings("gemini:x", {})).toEqual(["GEMINI_API_KEY"]);
  });

  it("builds ids with the provider prefix", () => {
    for (const spec of ["anthropic:a", "openai:b", "openai-compatible:c", "gemini:d"]) {
      expect(createAdapter(spec, {}).id).toBe(spec);
    }
  });
});

describe("anthropic", () => {
  it("streams text and usage", async () => {
    const { fetcher, calls } = fakeFetch(anthropicStream);
    const adapter = createAdapter(
      "anthropic:claude-test",
      { ANTHROPIC_API_KEY: "test-key" },
      fetcher,
    );
    expect(await collect(adapter)).toEqual({
      text: "[en] Hi there.",
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    expect(calls[0].body).toMatchObject({
      model: "claude-test",
      max_tokens: 50,
      system: "Be brief.",
      stream: true,
    });
    expect(calls[0].body.thinking).toBeUndefined();
  });

  it("keeps the thinking setting for the model that needs it", async () => {
    const { fetcher, calls } = fakeFetch(anthropicStream);
    await collect(
      createAdapter("anthropic:claude-sonnet-5-5", { ANTHROPIC_API_KEY: "test-key" }, fetcher),
    );
    expect(calls[0].body.thinking).toEqual({ type: "between_tools" });
  });

  it("aborts promptly", async () => {
    const { fetcher } = fakeFetch(anthropicStream.slice(0, 3), { hang: true });
    await abortsPromptly(
      createAdapter("anthropic:claude-test", { ANTHROPIC_API_KEY: "test-key" }, fetcher),
    );
  });

  it("turns provider errors into ModelError", async () => {
    const { fetcher } = fakeFetch([], {
      status: 401,
      json: {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      },
    });
    const error = await collect(
      createAdapter("anthropic:claude-test", { ANTHROPIC_API_KEY: "bad" }, fetcher),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({
      status: 401,
      type: "authentication_error",
      message: "invalid x-api-key",
    });
    expect(JSON.stringify(error)).not.toContain("bad");
  });

  it("reports a missing key without calling out", async () => {
    const { fetcher, calls } = fakeFetch(anthropicStream);
    const error = await collect(createAdapter("anthropic:claude-test", {}, fetcher)).catch(
      (e) => e,
    );
    expect(error).toMatchObject({ type: "configuration", message: "Missing ANTHROPIC_API_KEY" });
    expect(calls).toHaveLength(0);
  });

  it("completes with usage", async () => {
    const { fetcher } = fakeFetch([], {
      json: {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-test",
        content: [{ type: "text", text: "Fixed." }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 3 },
      },
    });
    const result = await createAdapter(
      "anthropic:claude-test",
      { ANTHROPIC_API_KEY: "k" },
      fetcher,
    ).complete({ system: "s", prompt: "p", maxTokens: 150 });
    expect(result).toEqual({ text: "Fixed.", usage: { inputTokens: 20, outputTokens: 3 } });
  });
});

describe("openai and openai-compatible", () => {
  it("streams text and usage from OpenAI", async () => {
    const { fetcher, calls } = fakeFetch(openaiStream);
    const adapter = createAdapter("openai:gpt-test", { OPENAI_API_KEY: "test-key" }, fetcher);
    expect(await collect(adapter)).toEqual({
      text: "[en] Hi there.",
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].headers.authorization).toBe("Bearer test-key");
    expect(calls[0].body).toMatchObject({
      model: "gpt-test",
      max_completion_tokens: 50,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("uses the base URL, no key and the older token field for compatible servers", async () => {
    const { fetcher, calls } = fakeFetch(openaiStream.filter((line) => !line.includes("usage")));
    const adapter = createAdapter(
      "openai-compatible:llama3.2",
      { OPENAI_BASE_URL: "http://localhost:11434/v1/" },
      fetcher,
    );
    expect(await collect(adapter)).toEqual({ text: "[en] Hi there.", usage: undefined });
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body.max_tokens).toBe(50);
  });

  it("aborts promptly", async () => {
    const { fetcher } = fakeFetch(openaiStream.slice(0, 2), { hang: true });
    await abortsPromptly(createAdapter("openai:gpt-test", { OPENAI_API_KEY: "k" }, fetcher));
  });

  it("turns provider errors into ModelError", async () => {
    const { fetcher } = fakeFetch([], {
      status: 404,
      json: {
        error: {
          message: "The model `gpt-nope` does not exist",
          type: "invalid_request_error",
          code: "model_not_found",
        },
      },
    });
    const error = await collect(
      createAdapter("openai:gpt-nope", { OPENAI_API_KEY: "k" }, fetcher),
    ).catch((e) => e);
    expect(error).toMatchObject({
      status: 404,
      type: "invalid_request_error",
      message: "The model `gpt-nope` does not exist",
    });
  });

  it("flags a truncated completion", async () => {
    const { fetcher } = fakeFetch([], {
      json: { choices: [{ message: { content: "Half" }, finish_reason: "length" }] },
    });
    const error = await createAdapter("openai:gpt-test", { OPENAI_API_KEY: "k" }, fetcher)
      .complete({ system: "s", prompt: "p", maxTokens: 5 })
      .catch((e) => e);
    expect(error).toMatchObject({ type: "max_tokens" });
  });
});

describe("gemini", () => {
  it("streams text and usage, counting thinking as output", async () => {
    const { fetcher, calls } = fakeFetch(geminiStream);
    const adapter = createAdapter("gemini:gemini-test", { GEMINI_API_KEY: "test-key" }, fetcher);
    expect(await collect(adapter)).toEqual({
      text: "[en] Hi there.",
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
    );
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-key");
    expect(calls[0].body).toEqual({
      systemInstruction: { parts: [{ text: "Be brief." }] },
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: { maxOutputTokens: 50 },
    });
  });

  it("aborts promptly", async () => {
    const { fetcher } = fakeFetch(geminiStream.slice(0, 1), { hang: true });
    await abortsPromptly(createAdapter("gemini:gemini-test", { GEMINI_API_KEY: "k" }, fetcher));
  });

  it("turns provider errors into ModelError", async () => {
    const { fetcher } = fakeFetch([], {
      status: 400,
      json: {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
        },
      },
    });
    const error = await collect(
      createAdapter("gemini:gemini-test", { GEMINI_API_KEY: "k" }, fetcher),
    ).catch((e) => e);
    expect(error).toMatchObject({
      status: 400,
      type: "INVALID_ARGUMENT",
      message: "API key not valid. Please pass a valid API key.",
    });
  });

  it("completes with usage", async () => {
    const { fetcher } = fakeFetch([], {
      json: {
        candidates: [{ content: { parts: [{ text: "Fixed." }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3 },
      },
    });
    const result = await createAdapter(
      "gemini:gemini-test",
      { GEMINI_API_KEY: "k" },
      fetcher,
    ).complete({ system: "s", prompt: "p", maxTokens: 150 });
    expect(result).toEqual({ text: "Fixed.", usage: { inputTokens: 20, outputTokens: 3 } });
  });
});
