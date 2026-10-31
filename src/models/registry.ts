import { env } from "../config";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiCompatibleAdapter } from "./openai-compatible";
import type { Fetch, ModelAdapter } from "./types";

export const DEFAULT_MODEL = "anthropic:claude-sonnet-5-5";

type Settings = {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
};

const providers = {
  anthropic: { required: ["ANTHROPIC_API_KEY"] },
  openai: { required: ["OPENAI_API_KEY"] },
  "openai-compatible": { required: ["OPENAI_BASE_URL"] },
  gemini: { required: ["GEMINI_API_KEY"] },
} as const satisfies Record<string, { required: readonly (keyof Settings)[] }>;

type Provider = keyof typeof providers;

export class ModelConfigError extends Error {}

export function parseModel(spec: string): { provider: Provider; model: string } {
  const separator = spec.indexOf(":");
  const provider = spec.slice(0, separator);
  const model = spec.slice(separator + 1).trim();
  if (separator < 1 || !model) {
    throw new ModelConfigError(
      `Model "${spec}" must look like provider:model-id, for example ${DEFAULT_MODEL}`,
    );
  }
  if (!(provider in providers)) {
    throw new ModelConfigError(
      `Unknown model provider "${provider}". Use one of: ${Object.keys(providers).join(", ")}`,
    );
  }
  return { provider: provider as Provider, model };
}

export function createAdapter(spec: string, settings: Settings, fetcher?: Fetch): ModelAdapter {
  const { provider, model } = parseModel(spec);
  switch (provider) {
    case "anthropic":
      return anthropicAdapter(model, { apiKey: settings.ANTHROPIC_API_KEY, fetch: fetcher });
    case "openai":
    case "openai-compatible":
      return openaiCompatibleAdapter(model, {
        prefix: provider,
        apiKey: settings.OPENAI_API_KEY,
        baseUrl: settings.OPENAI_BASE_URL,
        fetch: fetcher,
      });
    case "gemini":
      return geminiAdapter(model, { apiKey: settings.GEMINI_API_KEY, fetch: fetcher });
  }
}

export function missingSettings(spec: string, settings: Settings): string[] {
  return providers[parseModel(spec).provider].required.filter((name) => !settings[name]);
}

const modelSpec = () => env.MODEL || DEFAULT_MODEL;
let main: ModelAdapter | undefined;
let fast: ModelAdapter | null | undefined;

export function model(): ModelAdapter {
  main ??= createAdapter(modelSpec(), env);
  return main;
}

// Transcript cleanup is optional. Without FAST_MODEL it is
// off, so no deployment pays for any second model which
// nobody selected, and the dashboard shows raw text.
export function fastModel(): ModelAdapter | null {
  if (fast === undefined) fast = env.FAST_MODEL ? createAdapter(env.FAST_MODEL, env) : null;
  return fast;
}

export function missingModelSettings(): string[] {
  const specs = [modelSpec(), ...(env.FAST_MODEL ? [env.FAST_MODEL] : [])];
  return [...new Set(specs.flatMap((spec) => missingSettings(spec, env)))];
}
