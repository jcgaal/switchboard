import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import twilio from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentsDir = path.resolve(import.meta.dirname, "../agents");
const authToken = "test-auth-token";

type Server = {
  post: (
    query: string,
    params: Record<string, string>,
    signed?: boolean,
  ) => Promise<{ status: number; xml: string }>;
  events: { type: string; payload: Record<string, unknown> }[];
  setVoices: (voices: Record<string, string>) => void;
  close: () => void;
};

let close = () => {};

// Each server gets fresh modules, so the agent and number map
// are read from the environment which this test stubs, and
// a real Twilio signature is checked for every webhook.
async function boot(agent: string, numberLanguages = ""): Promise<Server> {
  vi.stubEnv("AGENTS_DIR", agentsDir);
  vi.stubEnv("AGENT", agent);
  vi.stubEnv("NUMBER_LANGUAGES", numberLanguages);
  vi.stubEnv("TWILIO_AUTH_TOKEN", authToken);
  vi.stubEnv("SKIP_TWILIO_SIGNATURE", "false");
  vi.resetModules();
  const events: Server["events"] = [];
  vi.doMock("../src/events/bus", () => ({
    recordEvent: (_sid: string | null, type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload }),
  }));
  const { default: router } = await import("../src/twilio/twiml");
  const settings = await import("../src/voices/settings");
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  return {
    events,
    close,
    setVoices: (voices) => settings.setVoiceSettings({ engine: "neural", voices }),
    async post(query, params, signed = true) {
      const url = `https://${host}/voice${query}`;
      const headers: Record<string, string> = {
        "content-type": "application/x-www-form-urlencoded",
      };
      if (signed)
        headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(authToken, url, params);
      const response = await fetch(`http://${host}/voice${query}`, {
        method: "POST",
        headers,
        body: new URLSearchParams(params).toString(),
      });
      return { status: response.status, xml: await response.text() };
    },
  };
}

afterEach(() => {
  close();
  vi.unstubAllEnvs();
  vi.doUnmock("../src/events/bus");
});

const call = { CallSid: "CAtest", From: "+15550101" };
const attr = (xml: string, element: string, name: string) =>
  new RegExp(`<${element}\\b[^>]*\\b${name}="([^"]*)"`).exec(xml)?.[1];
const params = (xml: string) =>
  Object.fromEntries(
    [...xml.matchAll(/<Parameter name="([^"]+)" value="([^"]*)"\/>/g)].map(([, name, value]) => [
      name,
      value,
    ]),
  );

describe("menu TwiML", () => {
  it("rejects a request without a valid signature", async () => {
    const server = await boot("intake");
    expect((await server.post("", { ...call, To: "+15550100" }, false)).status).toBe(403);
    expect(server.events.map((event) => event.type)).toContain("error.signature");
  });

  it("speaks the prompts of the number's language with a keypad gather", async () => {
    const server = await boot("intake", '{"+1 555 0100":"en-US"}');
    const { status, xml } = await server.post("", { ...call, To: "+15550100" });
    expect(status).toBe(200);
    expect(xml).toContain(
      '<Gather input="dtmf" numDigits="1" timeout="3" actionOnEmptyResult="true"',
    );
    expect(attr(xml, "Gather", "action")).toMatch(
      /^https:\/\/127\.0\.0\.1:\d+\/voice\?stage=connect$/,
    );
    const says = [...xml.matchAll(/<Say language="([^"]+)" voice="([^"]+)">([^<]*)<\/Say>/g)].map(
      (match) => match.slice(1),
    );
    expect(says).toEqual([
      ["es-MX", "Polly.Mia-Neural", "Para español presione 1."],
      ["en-US", "Polly.Joanna-Neural", "To continue in English, please stay on the line."],
    ]);
  });

  it("falls back to the agent default language for other numbers", async () => {
    const server = await boot("intake", '{"+15550100":"en-US"}');
    const { xml } = await server.post("", { ...call, To: "+15550109" });
    expect(xml).toContain("For English press 2.");
  });

  it("goes straight to connect when the agent has no menu", async () => {
    const server = await boot("reminder");
    const { xml } = await server.post("", { ...call, To: "+15550100" });
    expect(xml).not.toContain("<Gather");
    expect(xml).toContain("<ConversationRelay");
    expect(params(xml).initialLanguage).toBe("en-US");
  });
});

describe("connect TwiML", () => {
  it("connects in the language picked on the keypad", async () => {
    const server = await boot("intake");
    const { xml } = await server.post("?stage=connect", { ...call, To: "+15550100", Digits: "2" });
    expect(attr(xml, "ConversationRelay", "url")).toMatch(/^wss:\/\/127\.0\.0\.1:\d+\/ws$/);
    expect(attr(xml, "ConversationRelay", "language")).toBe("en-US");
    expect(attr(xml, "ConversationRelay", "ttsLanguage")).toBe("en-US");
    expect(attr(xml, "ConversationRelay", "ttsProvider")).toBe("Amazon");
    expect(attr(xml, "ConversationRelay", "voice")).toBe("Joanna-Neural");
    expect(attr(xml, "ConversationRelay", "transcriptionLanguage")).toBe("multi");
    expect(attr(xml, "ConversationRelay", "transcriptionProvider")).toBe("Deepgram");
    expect(attr(xml, "ConversationRelay", "speechModel")).toBe("nova-3-general");
    expect(attr(xml, "ConversationRelay", "hints")).toContain("Salesforce");
    expect(attr(xml, "ConversationRelay", "interruptible")).toBe("any");
    expect(attr(xml, "ConversationRelay", "reportInputDuringAgentSpeech")).toBe("speech");
    expect(
      server.events.find((event) => event.type === "language.selected")?.payload,
    ).toMatchObject({
      language: "en-US",
      digit: "2",
      source: "keypad",
    });
  });

  it("speaks the greeting in its spoken form", async () => {
    const server = await boot("intake");
    const { xml } = await server.post("?stage=connect", { ...call, To: "+15550100", Digits: "2" });
    expect(attr(xml, "ConversationRelay", "welcomeGreeting")).toContain(
      "Hi, this is the Example Company assistant.",
    );
  });

  it("uses the number default when no digit was pressed", async () => {
    const server = await boot("intake", '{"+15550100":"en-US"}');
    const { xml } = await server.post("?stage=connect", { ...call, To: "+15550100", Digits: "" });
    expect(params(xml).initialLanguage).toBe("en-US");
    const other = await server.post("?stage=connect", { ...call, To: "+15550109" });
    expect(params(other.xml).initialLanguage).toBe("es-MX");
    expect(
      server.events
        .filter((event) => event.type === "language.selected")
        .map((event) => event.payload.source),
    ).toEqual(["number_default", "number_default"]);
  });

  it("registers one Language and one voice and locale pair per agent language", async () => {
    const server = await boot("intake");
    const { xml } = await server.post("?stage=connect", { ...call, To: "+15550100", Digits: "1" });
    const languages = [
      ...xml.matchAll(/<Language code="([^"]+)" ttsProvider="([^"]+)" voice="([^"]+)"\/>/g),
    ].map((match) => match.slice(1));
    expect(languages).toEqual([
      ["en-US", "Amazon", "Joanna-Neural"],
      ["es-MX", "Amazon", "Mia-Neural"],
    ]);
    expect(params(xml)).toEqual({
      initialLanguage: "es-MX",
      voiceEngine: "neural",
      "voice.en-US": "Amazon:Joanna-Neural",
      "locale.en-US": "en-US",
      "voice.es-MX": "Amazon:Mia-Neural",
      "locale.es-MX": "es-MX",
    });
  });

  it("announces the locale of each chosen voice", async () => {
    const server = await boot("intake");
    server.setVoices({ "en-US": "Amazon:Brian-Neural", "es-MX": "Amazon:Sergio-Neural" });
    const { xml } = await server.post("?stage=connect", { ...call, To: "+15550100", Digits: "2" });
    expect(attr(xml, "ConversationRelay", "language")).toBe("en-GB");
    expect(attr(xml, "ConversationRelay", "ttsLanguage")).toBe("en-GB");
    expect(xml).toContain('<Language code="en-GB" ttsProvider="Amazon" voice="Brian-Neural"/>');
    expect(xml).toContain('<Language code="es-ES" ttsProvider="Amazon" voice="Sergio-Neural"/>');
    expect(params(xml)["locale.es-MX"]).toBe("es-ES");
  });

  it("refuses a number map that names a language the agent lacks", async () => {
    const { parseNumberLanguages, loadAgent } = await import("../src/agents/load");
    const reminder = loadAgent(path.join(agentsDir, "reminder"));
    expect(() => parseNumberLanguages('{"+15550100":"es-MX"}', reminder)).toThrow(/does not list/);
    expect(() => parseNumberLanguages("not json", reminder)).toThrow(/not valid JSON/);
    expect(parseNumberLanguages('{"+1 (555) 0100":"en-US"}', reminder).get("15550100")).toBe(
      "en-US",
    );
  });
});
