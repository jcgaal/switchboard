import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VoiceEvent } from "../../src/shared/events";
import { applyEvent, type CallState } from "../../web/src/lib/transcript";

const events = readFileSync(new URL("../fixtures/call-events.ndjson", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => VoiceEvent.parse(JSON.parse(line)));

const replay = () =>
  events.reduce<Record<string, CallState>>((calls, event) => applyEvent(calls, event, ""), {});

describe("fixture call", () => {
  it("builds one call with the greeting, both callers and the agent replies", () => {
    const calls = replay();
    expect(Object.keys(calls)).toEqual(["CAfixture0000000000000000000000007"]);
    const call = Object.values(calls)[0];
    expect(call.from).toBe("+1 ••• ••• 0101");
    expect(call.language).toBe("es-MX");
    expect(call.turns.map((turn) => turn.role)).toEqual([
      "agent",
      "caller",
      "agent",
      "caller",
      "agent",
    ]);
    expect(call.turns[0].text).toMatch(/^Hi, this is the Example Co assistant\./);
  });

  it("shows the written form of agent text, never the spoken one", () => {
    const call = Object.values(replay())[0];
    expect(call.turns[2]).toMatchObject({
      text: " Mucho gusto. ¿Qué herramientas usa en Example Co?",
      done: true,
    });
    expect(call.turns.some((turn) => turn.text.includes("Example Company"))).toBe(false);
  });

  it("pins each normalized transcript to its prompt", () => {
    const call = Object.values(replay())[0];
    expect(call.turns[1]).toMatchObject({
      text: "Hi, this is Ana from Example Co, can we do this in Spanish?",
      normalized: "Hi, this is Ana from Example Co. Can we do this in Spanish?",
    });
    expect(call.turns[3].normalized).toBe("Usamos HubSpot y Salesforce.");
  });

  it("keeps only what the caller heard of an interrupted reply", () => {
    const call = Object.values(replay())[0];
    expect(call.turns[4]).toMatchObject({ text: "Mucho gusto.", interrupted: true, done: true });
  });

  it("totals usage from replies and transcript cleanup", () => {
    const call = Object.values(replay())[0];
    expect(call.usage).toMatchObject({ requests: 4, inputTokens: 1704, outputTokens: 46 });
    const greeting = call.turns[0].text.length;
    const spoken = " Mucho gusto. ¿Qué herramientas usa en Example Company?".length;
    expect(call.usage.ttsChars).toBe(greeting + spoken * 2);
  });

  it("reads the voices of every agent language", () => {
    const call = Object.values(replay())[0];
    expect(call.voices).toEqual({
      engine: "neural",
      voices: { "en-US": "Amazon:Joanna-Neural", "es-MX": "Amazon:Mia-Neural" },
    });
  });

  it("ends every talk cycle with an empty last text frame", () => {
    const ends = events.filter((event) => event.type === "model.stream.end").length;
    const lasts = events.filter(
      (event) =>
        event.type === "twilio.outbound" &&
        event.payload.last === true &&
        event.payload.token === "",
    ).length;
    expect(ends).toBe(2);
    expect(lasts).toBe(ends);
  });
});
