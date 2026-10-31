import { z } from "zod";

// Environment is parsed once at startup. Values stay optional here,
// and each reader keeps the prototype's fallback, so an empty or
// missing variable behaves exactly as it did before the move.
const Env = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  MODEL: z.string().optional(),
  FAST_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  SKIP_TWILIO_SIGNATURE: z.string().optional(),
  AGENTS_DIR: z.string().optional(),
  AGENT: z.string().optional(),
  NUMBER_LANGUAGES: z.string().optional(),
  CONTROL_TOKEN: z.string().optional(),
  PUBLIC_VOICE_PICKER: z.string().optional(),
  OBSERVER_TOKEN: z.string().optional(),
  OBSERVER_PUBLIC: z.string().optional(),
  SHOW_CALLER_NUMBERS: z.string().optional(),
  EVENT_REPLAY: z.string().optional(),
  PUBLIC_NUMBERS: z.string().optional(),
  REPO_URL: z.string().optional(),
  MAX_CONCURRENT_CALLS: z.string().optional(),
});

export const env = Env.parse(process.env);

export function listenPort(): number {
  if (!env.PORT) {
    throw new Error("PORT environment variable is required but was not provided.");
  }
  const port = Number(env.PORT);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${env.PORT}"`);
  }
  return port;
}

export const skipSignature = () => env.SKIP_TWILIO_SIGNATURE === "true";
