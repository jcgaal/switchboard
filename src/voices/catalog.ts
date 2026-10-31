import type { VoiceOption } from "../shared/voices";
import { voiceKey } from "../shared/voices";

// Every Polly voice Twilio lists for these four locales. Spanish has
// one woman and one man per engine, and British English gets just
// one generative voice, so those rows are shorter than others.
const POLLY: [string, VoiceOption["gender"], string, ("neural" | "generative")[]][] = [
  ["Joanna", "female", "en-US", ["neural", "generative"]],
  ["Danielle", "female", "en-US", ["neural", "generative"]],
  ["Matthew", "male", "en-US", ["neural", "generative"]],
  ["Stephen", "male", "en-US", ["neural", "generative"]],
  ["Amy", "female", "en-GB", ["neural", "generative"]],
  ["Emma", "female", "en-GB", ["neural"]],
  ["Arthur", "male", "en-GB", ["neural"]],
  ["Brian", "male", "en-GB", ["neural"]],
  ["Mia", "female", "es-MX", ["neural"]],
  ["Mía", "female", "es-MX", ["generative"]],
  ["Andres", "male", "es-MX", ["neural", "generative"]],
  ["Lucia", "female", "es-ES", ["neural", "generative"]],
  ["Sergio", "male", "es-ES", ["neural", "generative"]],
];

// Every voice expands to one option per engine it supports.
// Ids use the Name-Engine format which ConversationRelay
// expects in the voice attribute, e.g. Joanna-Neural.
const polly: VoiceOption[] = POLLY.flatMap(([name, gender, locale, engines]) =>
  engines.map((engine) => ({
    id: `${name}-${engine === "neural" ? "Neural" : "Generative"}`,
    provider: "Amazon",
    name,
    gender,
    locale,
    engine,
  })),
);

// Other providers join as more rows of data in this array.
// Nothing else in the server names a provider or voice,
// so adding one needs no edits outside of this file.
export const VOICE_CATALOG: VoiceOption[] = [...polly];

// Lookups by key walk the catalog linearly. It is small
// enough that one scan costs nothing measurable next
// to the network round trip behind every request.
export const voiceByKey = (key: string) => VOICE_CATALOG.find((voice) => voiceKey(voice) === key);
