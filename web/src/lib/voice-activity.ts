import type { VoiceEvent } from "@/hooks/use-event-stream";

export type Speaker = "caller" | "agent";

// The browser never hears the call, only its events, so speech is
// inferred: the agent from outbound TTS text at about 15 chars
// a second, and the caller from any finalized prompt event.
export const VOICE_TIMING = {
  charsPerSecond: 15,
  callerMinMs: 900,
  callerMaxMs: 3500,
  pollMs: 150,
};

type Activity = { callerUntil: number; agentUntil: number };

// Speech time grows linearly with the length of the text, and
// payload fields that are not strings count as empty, so a
// malformed event never stretches or breaks a deadline.
const speechMs = (text: string) => (text.length / VOICE_TIMING.charsPerSecond) * 1000;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Each call keeps two deadlines, one for the caller and one for
// the agent. Whoever still has time left on the clock is the
// speaker returned whenever the wave asks who is talking.
export class VoiceActivity {
  private calls = new Map<string, Activity>();

  // Outbound text pushes the agent's deadline forward by the time its
  // words take to be heard, while an interrupt, an end or a hangup
  // cuts the current speech off as soon as that event is noted.
  note(e: VoiceEvent, now = Date.now()) {
    if (!e.callSid) return;
    const a = this.calls.get(e.callSid) ?? { callerUntil: 0, agentUntil: 0 };
    this.calls.set(e.callSid, a);
    const p = e.payload;
    switch (e.type) {
      case "call.started":
        a.agentUntil = now + speechMs(str(p.welcomeGreeting));
        break;
      case "twilio.inbound":
        if (p.type === "prompt" && p.last === true) {
          a.callerUntil =
            now +
            Math.min(
              VOICE_TIMING.callerMaxMs,
              Math.max(VOICE_TIMING.callerMinMs, speechMs(str(p.voicePrompt))),
            );
        }
        if (p.type === "interrupt") a.agentUntil = now;
        break;
      case "twilio.outbound":
        if (p.type === "text") a.agentUntil = Math.max(a.agentUntil, now) + speechMs(str(p.token));
        if (p.type === "end") a.agentUntil = a.callerUntil = now;
        break;
      case "call.ended":
        a.agentUntil = a.callerUntil = now;
        break;
    }
  }

  speaker(callSid: string | null | undefined, now = Date.now()): Speaker | null {
    const a = callSid ? this.calls.get(callSid) : undefined;
    if (!a) return null;
    // The caller wins whenever both deadlines overlap. Talking over
    // the agent is the newer and more relevant signal, typically
    // while the agent is still finishing off its final words.
    if (a.callerUntil > now) return "caller";
    if (a.agentUntil > now) return "agent";
    return null;
  }

  // Clearing the dashboard drops every call's deadlines, so the
  // wave settles back into rest until the next event arrives
  // and hands either of the two speakers the floor again.
  clear() {
    this.calls.clear();
  }
}
