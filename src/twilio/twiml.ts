import { Router, type IRouter } from "express";
import twilio from "twilio";
import type VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { agent, agentLanguage, languageForNumber } from "../agents/load";
import { recordEvent } from "../events/bus";
import { liveCallCount, refusal } from "../session/capacity";
import { pronounce } from "../session/speech-text";
import { voiceKey } from "../shared/voices";
import { getVoiceSettings, voiceForLanguage } from "../voices/settings";
import { requestHost, validSignature } from "./signature";

type SayAttributes = VoiceResponse.SayAttributes;

const router: IRouter = Router();

// Agent files name voices as provider:id. The keypad menu
// speaks through Say, which writes any Amazon voice as
// Polly.<id>, and only that prefix needs to change.
function sayVoice(voice: string): string {
  const [provider, id] = voice.split(":");
  return provider === "Amazon" ? `Polly.${id}` : id;
}

router.post("/voice", (req, res) => {
  const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : null;
  recordEvent(callSid, "webhook.received", {
    method: req.method,
    path: "/voice",
    from: req.body?.From,
  });
  const body = req.body ?? {};
  if (!validSignature(req, req.originalUrl, body)) {
    recordEvent(callSid, "error.signature", {
      path: "/voice",
      reason: "Invalid or missing Twilio signature",
    });
    res.sendStatus(403);
    return;
  }
  const host = requestHost(req);
  if (!host) {
    res.status(400).json({ error: "Invalid request Host" });
    return;
  }
  const response = new twilio.twiml.VoiceResponse();
  const refused = refusal();
  if (refused) {
    response.reject({ reason: "busy" });
    const xml = response.toString();
    recordEvent(callSid, "call.rejected", { reason: refused, liveCalls: liveCallCount() });
    recordEvent(callSid, "twiml.returned", { xml });
    res.type("text/xml").send(xml);
    return;
  }
  const { language_menu: menu, languages, transcription, pronunciation } = agent();
  const defaultLanguage = languageForNumber(req.body?.To);
  if (menu?.enabled && req.query.stage !== "connect") {
    // Gather listens for a keypad press across every prompt, then
    // times out quickly and falls back to the default language
    // of the number each caller dialed to reach this agent.
    const gather = response.gather({
      input: ["dtmf"],
      numDigits: 1,
      timeout: menu.timeout_seconds,
      actionOnEmptyResult: true,
      action: `https://${host}/voice?stage=connect`,
      method: "POST",
    });
    for (const prompt of menu.prompts[defaultLanguage] ??
      menu.prompts[agent().default_language] ??
      []) {
      gather.say(
        {
          language: prompt.language as SayAttributes["language"],
          voice: sayVoice(agentLanguage(prompt.language).default_voice) as SayAttributes["voice"],
        },
        pronounce(prompt.text, pronunciation),
      );
    }
    const xml = response.toString();
    recordEvent(callSid, "twiml.returned", { xml });
    res.type("text/xml").send(xml);
    return;
  }
  const digit = typeof req.body?.Digits === "string" ? req.body.Digits : "";
  const chosen = menu?.enabled ? menu.options[digit] : undefined;
  const language = chosen ?? defaultLanguage;
  recordEvent(callSid, "language.selected", {
    to: req.body?.To,
    language,
    digit: digit || null,
    source: chosen ? "keypad" : "number_default",
  });
  // Voices are read once here and travel with the call as parameters.
  // A picker change midway cannot alter live TwiML, and the socket
  // session announces the locales that match the chosen voices.
  const settings = getVoiceSettings();
  const slots = Object.keys(languages).map((slot) => ({
    slot,
    voice: voiceForLanguage(settings, slot),
  }));
  const initial = voiceForLanguage(settings, language);
  const relay = response.connect().conversationRelay({
    url: `wss://${host}/ws`,
    welcomeGreeting: pronounce(agentLanguage(language).greeting, pronunciation),
    language: initial.locale,
    ttsLanguage: initial.locale,
    transcriptionLanguage: transcription.language,
    ttsProvider: initial.provider,
    voice: initial.id,
    transcriptionProvider: transcription.provider,
    speechModel: transcription.model,
    hints: transcription.hints.length ? transcription.hints.join(",") : undefined,
    interruptible: "any",
  });
  // The Twilio SDK still types this attribute as a legacy
  // boolean, but TwiML now needs an enum string, so it
  // is set as a raw attribute on the relay element.
  relay.conversationRelay.att("reportInputDuringAgentSpeech", "speech");
  relay.parameter({ name: "initialLanguage", value: language });
  relay.parameter({ name: "voiceEngine", value: settings.engine });
  for (const { slot, voice } of slots) {
    relay.parameter({ name: `voice.${slot}`, value: voiceKey(voice) });
    relay.parameter({ name: `locale.${slot}`, value: voice.locale });
  }
  // Two slots may share one voice locale, and Twilio expects
  // Language elements once per code, so the first slot to
  // name a locale chooses the one voice that reads it.
  const registered = new Set<string>();
  for (const { voice } of slots) {
    if (registered.has(voice.locale)) continue;
    registered.add(voice.locale);
    relay.language({ code: voice.locale, ttsProvider: voice.provider, voice: voice.id });
  }
  const xml = response.toString();
  recordEvent(callSid, "twiml.returned", { xml });
  res.type("text/xml").send(xml);
});

export default router;
