import { z } from "zod";

// These schemas are the one contract for voice settings. The server
// validates requests and responses with these, and the dashboard
// imports the same types, so neither side keeps its own copy.
export const VoiceOption = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  gender: z.enum(["female", "male"]),
  locale: z.string(),
  engine: z.string(),
});

// Settings hold one voice per agent language, keyed by locale,
// and every voice is spelled provider:id, which is the form
// that agent files use in each language's default_voice.
export const VoiceSettings = z.object({
  engine: z.string().min(1),
  voices: z.record(z.string(), z.string()),
});

// Control says who may change the next call's voices: anyone,
// only holders of CONTROL_TOKEN, or nobody at all, so each
// dashboard shows a picker which is editable or locked.
export const VoiceControl = z.enum(["open", "token", "locked"]);

export const VoiceSettingsState = z.object({
  settings: VoiceSettings,
  catalog: z.array(VoiceOption),
  control: VoiceControl,
});

export type VoiceOption = z.infer<typeof VoiceOption>;
export type VoiceSettings = z.infer<typeof VoiceSettings>;
export type VoiceControl = z.infer<typeof VoiceControl>;
export type VoiceSettingsState = z.infer<typeof VoiceSettingsState>;

export const voiceKey = (voice: VoiceOption) => `${voice.provider}:${voice.id}`;

// A voice fits a slot when both share their language prefix,
// so a British voice may read for any en-US slot, and the
// accent stays a choice, rather than an agent setting.
export const languageOf = (locale: string) => locale.split("-")[0].toLowerCase();
export const fitsSlot = (voice: VoiceOption, slot: string) =>
  languageOf(voice.locale) === languageOf(slot);

// Twilio spells the generative Mexican voice as Mía and the
// neural one as Mia, so accents are removed before names
// are compared and either spelling maps to one voice.
const plain = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Switching engines keeps the same person when the other engine
// has them, then falls back to a voice with the same accent,
// and then to any voice which speaks the slot's language.
export function counterpart(
  catalog: VoiceOption[],
  key: string,
  engine: string,
  slot: string,
): string | undefined {
  const from = catalog.find((voice) => voiceKey(voice) === key);
  const pool = catalog.filter((voice) => voice.engine === engine && fitsSlot(voice, slot));
  const match =
    pool.find(
      (voice) => from && voice.provider === from.provider && plain(voice.name) === plain(from.name),
    ) ??
    pool.find((voice) => voice.locale === from?.locale) ??
    pool[0];
  return match && voiceKey(match);
}
