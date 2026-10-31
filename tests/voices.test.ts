import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadAgent } from "../src/agents/load";
import type { Agent } from "../src/agents/schema";
import { counterpart, fitsSlot, voiceKey, type VoiceSettings } from "../src/shared/voices";
import { VOICE_CATALOG, voiceByKey } from "../src/voices/catalog";
import {
  catalogFor,
  defaultVoiceSettings,
  voiceSettingsError,
  VoiceSettingsError,
} from "../src/voices/settings";

const agentsDir = path.resolve(import.meta.dirname, "../agents");
const intake = loadAgent(path.join(agentsDir, "intake"));
const reminder = loadAgent(path.join(agentsDir, "reminder"));
const keys = VOICE_CATALOG.map(voiceKey);

describe("catalog", () => {
  it("ships the 13 Polly voices as 21 provider:id entries", () => {
    expect(new Set(VOICE_CATALOG.map((voice) => voice.name)).size).toBe(13);
    expect(VOICE_CATALOG).toHaveLength(21);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses the ids ConversationRelay expects", () => {
    expect(keys).toContain("Amazon:Joanna-Neural");
    expect(keys).toContain("Amazon:Mía-Generative");
    expect(keys).toContain("Amazon:Mia-Neural");
    for (const voice of VOICE_CATALOG) {
      expect(voice.id).toMatch(/^[\p{L}]+-(Neural|Generative)$/u);
      expect(voice.engine).toBe(voice.id.endsWith("-Neural") ? "neural" : "generative");
    }
  });

  it("covers en-US, en-GB, es-MX and es-ES", () => {
    expect(new Set(VOICE_CATALOG.map((voice) => voice.locale))).toEqual(
      new Set(["en-US", "en-GB", "es-MX", "es-ES"]),
    );
  });

  it("filters to the languages of the agent", () => {
    expect(catalogFor(intake)).toHaveLength(VOICE_CATALOG.length);
    const english = catalogFor(reminder);
    expect(english.length).toBeGreaterThan(0);
    expect(english.every((voice) => voice.locale.startsWith("en-"))).toBe(true);
  });
});

describe("validation", () => {
  const valid: VoiceSettings = {
    engine: "neural",
    voices: { "en-US": "Amazon:Joanna-Neural", "es-MX": "Amazon:Mia-Neural" },
  };
  const error = (voices: Record<string, string>, engine = "neural", agent: Agent = intake) =>
    voiceSettingsError({ engine, voices }, agent);

  it("starts from the agent default voices", () => {
    expect(defaultVoiceSettings(intake)).toEqual(valid);
    expect(defaultVoiceSettings(reminder)).toEqual({
      engine: "neural",
      voices: { "en-US": "Amazon:Joanna-Neural" },
    });
  });

  it("accepts one matching voice per agent language", () => {
    expect(voiceSettingsError(valid, intake)).toBeNull();
  });

  it("matches slots by language prefix", () => {
    expect(fitsSlot(voiceByKey("Amazon:Amy-Neural")!, "en-US")).toBe(true);
    expect(error({ "en-US": "Amazon:Brian-Neural", "es-MX": "Amazon:Sergio-Neural" })).toBeNull();
  });

  it("rejects unknown voices", () => {
    expect(error({ ...valid.voices, "en-US": "Amazon:Nobody-Neural" })).toMatch(/Unknown voice/);
    expect(error({ ...valid.voices, "en-US": "Joanna-Neural" })).toMatch(/Unknown voice/);
  });

  it("rejects a voice on another engine", () => {
    expect(error({ ...valid.voices, "es-MX": "Amazon:Mía-Generative" })).toMatch(/engine/);
  });

  it("rejects a voice in the wrong language", () => {
    expect(error({ "en-US": "Amazon:Mia-Neural", "es-MX": "Amazon:Joanna-Neural" })).toMatch(
      /does not fit en-US/,
    );
  });

  it("rejects missing and extra slots", () => {
    expect(error({ "en-US": "Amazon:Joanna-Neural" })).toMatch(/Missing a voice for es-MX/);
    expect(error({ ...valid.voices, "fr-FR": "Amazon:Joanna-Neural" })).toMatch(
      /No agent language for fr-FR/,
    );
  });

  it("fails at startup when an agent default voice is invalid", () => {
    const broken: Agent = {
      ...reminder,
      languages: {
        "en-US": { ...reminder.languages["en-US"], default_voice: "Amazon:Mia-Neural" },
      },
    };
    expect(() => defaultVoiceSettings(broken)).toThrow(VoiceSettingsError);
    expect(() => defaultVoiceSettings(broken)).toThrow(/default_voice/);
  });
});

describe("counterpart", () => {
  it("keeps the same person across engines", () => {
    expect(counterpart(VOICE_CATALOG, "Amazon:Joanna-Neural", "generative", "en-US")).toBe(
      "Amazon:Joanna-Generative",
    );
  });

  it("treats Mia and Mía as one person", () => {
    expect(counterpart(VOICE_CATALOG, "Amazon:Mia-Neural", "generative", "es-MX")).toBe(
      "Amazon:Mía-Generative",
    );
    expect(counterpart(VOICE_CATALOG, "Amazon:Mía-Generative", "neural", "es-MX")).toBe(
      "Amazon:Mia-Neural",
    );
  });

  it("falls back to the same accent, then to the language", () => {
    expect(counterpart(VOICE_CATALOG, "Amazon:Brian-Neural", "generative", "en-US")).toBe(
      "Amazon:Amy-Generative",
    );
    const usOnly = VOICE_CATALOG.filter(
      (voice) => voice.locale !== "en-GB" || voice.engine === "neural",
    );
    expect(counterpart(usOnly, "Amazon:Brian-Neural", "generative", "en-US")).toBe(
      "Amazon:Joanna-Generative",
    );
  });

  it("returns nothing when no voice fits", () => {
    expect(
      counterpart(VOICE_CATALOG, "Amazon:Joanna-Neural", "generative", "fr-FR"),
    ).toBeUndefined();
  });
});

describe("voice settings routes", () => {
  let base = "";
  let close = () => {};
  let config: { CONTROL_TOKEN?: string; PUBLIC_VOICE_PICKER?: string };
  let events: { type: string; payload: unknown }[] = [];

  beforeAll(async () => {
    vi.stubEnv("AGENTS_DIR", agentsDir);
    vi.stubEnv("AGENT", "intake");
    vi.resetModules();
    vi.doMock("../src/events/bus", () => ({
      recordEvent: (_sid: string | null, type: string, payload: unknown) =>
        events.push({ type, payload }),
    }));
    ({ env: config } = await import("../src/config"));
    const { default: router } = await import("../src/routes/voice-settings");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/voice-settings`;
    close = () => server.close();
  });

  afterAll(() => {
    close();
    vi.unstubAllEnvs();
    vi.doUnmock("../src/events/bus");
  });

  const put = (body: unknown, token?: string) =>
    fetch(base, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const generative = {
    engine: "generative",
    voices: { "en-US": "Amazon:Matthew-Generative", "es-MX": "Amazon:Andres-Generative" },
  };

  it("returns settings, the agent catalog and the control mode", async () => {
    config.CONTROL_TOKEN = undefined;
    config.PUBLIC_VOICE_PICKER = undefined;
    const state = await (await fetch(base)).json();
    expect(state.settings).toEqual({
      engine: "neural",
      voices: { "en-US": "Amazon:Joanna-Neural", "es-MX": "Amazon:Mia-Neural" },
    });
    expect(state.catalog).toHaveLength(VOICE_CATALOG.length);
    expect(state.control).toBe("locked");
  });

  it("is read-only without CONTROL_TOKEN or PUBLIC_VOICE_PICKER", async () => {
    expect((await put(generative)).status).toBe(403);
  });

  it("requires the control token once one is set", async () => {
    config.CONTROL_TOKEN = "secret-token";
    config.PUBLIC_VOICE_PICKER = "true";
    expect((await put(generative)).status).toBe(401);
    expect((await put(generative, "wrong")).status).toBe(401);
    events = [];
    const response = await put(generative, "secret-token");
    expect(response.status).toBe(200);
    expect((await response.json()).settings).toEqual(generative);
    expect(events).toEqual([{ type: "voice.settings", payload: generative }]);
  });

  it("opens to anyone with PUBLIC_VOICE_PICKER and no token", async () => {
    config.CONTROL_TOKEN = undefined;
    const state = await (await fetch(base)).json();
    expect(state.control).toBe("open");
    expect(
      (
        await put({
          ...generative,
          voices: { ...generative.voices, "en-US": "Amazon:Joanna-Generative" },
        })
      ).status,
    ).toBe(200);
  });

  it("answers 422 for invalid voices and keeps the last choice", async () => {
    events = [];
    const response = await put({
      engine: "neural",
      voices: { "en-US": "Amazon:Joanna-Neural", "es-MX": "Amazon:Andres-Generative" },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/Andres-Generative/);
    expect((await put({ engine: "neural", english: "Amazon:Joanna-Neural" })).status).toBe(422);
    expect(events).toEqual([]);
    expect((await (await fetch(base)).json()).settings.voices["en-US"]).toBe(
      "Amazon:Joanna-Generative",
    );
  });
});
