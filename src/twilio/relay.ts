import { z } from "zod";

// A field of the wrong type reads as missing instead of failing the
// whole message, so the session applies its own rules to it, and
// a sloppy frame is handled the same as before, not rejected.
const text = z.string().optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);

export const SetupMessage = z.object({
  type: z.literal("setup"),
  callSid: text,
  from: text,
  to: text,
  customParameters: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export const PromptMessage = z.object({
  type: z.literal("prompt"),
  voicePrompt: text,
  last: flag,
  lang: text,
});

export const InterruptMessage = z.object({
  type: z.literal("interrupt"),
  utteranceUntilInterrupt: text,
});

export const DtmfMessage = z.object({
  type: z.literal("dtmf"),
  digit: text,
});

export const ErrorMessage = z.object({
  type: z.literal("error"),
  description: text,
});

export const InboundMessage = z.discriminatedUnion("type", [
  SetupMessage,
  PromptMessage,
  InterruptMessage,
  DtmfMessage,
  ErrorMessage,
]);

export type SetupMessage = z.infer<typeof SetupMessage>;
export type PromptMessage = z.infer<typeof PromptMessage>;
export type InterruptMessage = z.infer<typeof InterruptMessage>;
export type DtmfMessage = z.infer<typeof DtmfMessage>;
export type ErrorMessage = z.infer<typeof ErrorMessage>;
export type UnknownMessage = { type: "unknown" };
export type Inbound = z.infer<typeof InboundMessage> | UnknownMessage;

export const TextMessage = z.object({
  type: z.literal("text"),
  token: z.string(),
  last: z.boolean(),
});

export const LanguageMessage = z.object({
  type: z.literal("language"),
  ttsLanguage: z.string(),
});

export const EndMessage = z.object({
  type: z.literal("end"),
});

export const OutboundMessage = z.discriminatedUnion("type", [
  TextMessage,
  LanguageMessage,
  EndMessage,
]);

export type TextMessage = z.infer<typeof TextMessage>;
export type LanguageMessage = z.infer<typeof LanguageMessage>;
export type EndMessage = z.infer<typeof EndMessage>;
export type Outbound = z.infer<typeof OutboundMessage>;

export type InboundResult =
  { ok: true; message: Inbound; raw: Record<string, unknown> } | { ok: false; reason: string };

// The raw object is kept next to the typed message, because the
// event stream records each frame exactly as Twilio sent it,
// extra fields included, for anyone who debugs the relay.
export function parseInbound(raw: string): InboundResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Message is not valid JSON" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "Message must be a JSON object" };
  }
  const record = data as Record<string, unknown>;
  const known = InboundMessage.safeParse(record);
  return { ok: true, message: known.success ? known.data : { type: "unknown" }, raw: record };
}
