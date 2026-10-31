import { agent as currentAgent } from "../agents/load";
import type { Agent } from "../agents/schema";
import { fitsSlot, type VoiceOption, type VoiceSettings } from "../shared/voices";
import { VOICE_CATALOG, voiceByKey } from "./catalog";

export class VoiceSettingsError extends Error {}

// Only catalog voices are accepted. Each must share the chosen
// engine and speak the language of its slot, and each agent
// language needs one. Nothing falls back to any default.
export function voiceSettingsError(input: VoiceSettings, agent: Agent): string | null {
  const slots = Object.keys(agent.languages);
  const extra = Object.keys(input.voices).filter((slot) => !slots.includes(slot));
  if (extra.length) return `No agent language for ${extra.join(", ")}`;
  for (const slot of slots) {
    const key = input.voices[slot];
    if (!key) return `Missing a voice for ${slot}`;
    const voice = voiceByKey(key);
    if (!voice) return `Unknown voice ${key} for ${slot}`;
    if (voice.engine !== input.engine) return `${key} does not use the ${input.engine} engine`;
    if (!fitsSlot(voice, slot)) return `${key} speaks ${voice.locale}, which does not fit ${slot}`;
  }
  return null;
}

// The agent's default voices are the first choice. They are
// checked at startup like any later change, so any agent
// which names an unknown voice fails while deploying.
export function defaultVoiceSettings(agent: Agent): VoiceSettings {
  const voices = Object.fromEntries(
    Object.entries(agent.languages).map(([locale, language]) => [locale, language.default_voice]),
  );
  const first = voiceByKey(voices[agent.default_language]);
  const settings = { engine: first?.engine ?? "", voices };
  const error = voiceSettingsError(settings, agent);
  if (error) throw new VoiceSettingsError(`Agent ${agent.name} default_voice: ${error}`);
  return settings;
}

// The catalog sent to dashboards lists only voices that can
// fill one of the agent's slots, so the picker offers no
// voice that the server would then reject with a 422.
export const catalogFor = (agent: Agent): VoiceOption[] =>
  VOICE_CATALOG.filter((voice) =>
    Object.keys(agent.languages).some((slot) => fitsSlot(voice, slot)),
  );

// One process-wide choice applies to the next call that connects.
// It lives in memory on a single instance, so several replicas
// would each keep their own, and a restart resets defaults.
let current: VoiceSettings | undefined;

const copy = (settings: VoiceSettings): VoiceSettings => ({
  engine: settings.engine,
  voices: { ...settings.voices },
});

export function getVoiceSettings(): VoiceSettings {
  current ??= defaultVoiceSettings(currentAgent());
  return copy(current);
}

export function setVoiceSettings(input: VoiceSettings): VoiceSettings {
  const error = voiceSettingsError(input, currentAgent());
  if (error) throw new VoiceSettingsError(error);
  current = copy(input);
  return getVoiceSettings();
}

// Calls reason in agent languages while Twilio needs the locale
// of the actual voice, so any British voice in an en-US slot
// is announced as en-GB each time that the call switches.
export function voiceForLanguage(settings: VoiceSettings, language: string): VoiceOption {
  return voiceByKey(settings.voices[language] ?? Object.values(settings.voices)[0])!;
}
