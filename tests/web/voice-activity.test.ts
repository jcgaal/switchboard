import { describe, expect, it } from "vitest";
import type { VoiceEvent } from "../../src/shared/events";
import { VOICE_TIMING, VoiceActivity } from "../../web/src/lib/voice-activity";

const sid = "CAtest";
const event = (type: string, payload: Record<string, unknown> = {}): VoiceEvent => ({
  timestamp: "",
  callSid: sid,
  type,
  payload,
});
const text = (token: string) => event("twilio.outbound", { type: "text", token, last: false });
const prompt = (voicePrompt: string) =>
  event("twilio.inbound", { type: "prompt", voicePrompt, last: true });

describe("voice activity", () => {
  it("keeps the agent speaking for the length of its text", () => {
    const voice = new VoiceActivity();
    voice.note(text("x".repeat(30)), 0);
    expect(voice.speaker(sid, 1_999)).toBe("agent");
    expect(voice.speaker(sid, 2_001)).toBeNull();
  });

  it("extends the agent deadline with each token", () => {
    const voice = new VoiceActivity();
    voice.note(text("x".repeat(15)), 0);
    voice.note(text("x".repeat(15)), 500);
    expect(voice.speaker(sid, 1_999)).toBe("agent");
    expect(voice.speaker(sid, 2_001)).toBeNull();
  });

  it("starts the agent with the greeting", () => {
    const voice = new VoiceActivity();
    voice.note(event("call.started", { welcomeGreeting: "x".repeat(45) }), 0);
    expect(voice.speaker(sid, 2_900)).toBe("agent");
  });

  it("bounds caller speech between the minimum and maximum", () => {
    const voice = new VoiceActivity();
    voice.note(prompt("Hi"), 0);
    expect(voice.speaker(sid, VOICE_TIMING.callerMinMs - 1)).toBe("caller");
    expect(voice.speaker(sid, VOICE_TIMING.callerMinMs + 1)).toBeNull();
    voice.note(prompt("x".repeat(500)), 10_000);
    expect(voice.speaker(sid, 10_000 + VOICE_TIMING.callerMaxMs - 1)).toBe("caller");
    expect(voice.speaker(sid, 10_000 + VOICE_TIMING.callerMaxMs + 1)).toBeNull();
  });

  it("lets the caller win while both overlap", () => {
    const voice = new VoiceActivity();
    voice.note(text("x".repeat(150)), 0);
    voice.note(prompt("Wait, one thing"), 1_000);
    expect(voice.speaker(sid, 1_500)).toBe("caller");
    expect(voice.speaker(sid, 5_000)).toBe("agent");
  });

  it("cuts speech off on interrupt, end and hangup", () => {
    const voice = new VoiceActivity();
    voice.note(text("x".repeat(150)), 0);
    voice.note(event("twilio.inbound", { type: "interrupt" }), 1_000);
    expect(voice.speaker(sid, 1_001)).toBeNull();
    voice.note(text("x".repeat(150)), 2_000);
    voice.note(event("twilio.outbound", { type: "end" }), 2_500);
    expect(voice.speaker(sid, 2_501)).toBeNull();
    voice.note(prompt("Hello there"), 3_000);
    voice.note(event("call.ended"), 3_100);
    expect(voice.speaker(sid, 3_101)).toBeNull();
  });

  it("forgets every call on clear and ignores unknown calls", () => {
    const voice = new VoiceActivity();
    voice.note(text("x".repeat(150)), 0);
    voice.clear();
    expect(voice.speaker(sid, 1)).toBeNull();
    expect(voice.speaker("CAother", 1)).toBeNull();
    expect(voice.speaker(null, 1)).toBeNull();
  });
});
