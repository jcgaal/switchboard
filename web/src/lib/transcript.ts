import type { VoiceEvent } from "@/hooks/use-event-stream";

export type Turn = {
  id: number;
  role: "agent" | "caller";
  text: string;
  done: boolean;
  interrupted?: boolean;
  at: string;
  promptId?: string;
  normalized?: string;
  language?: string;
};

// Usage is kept per call as running totals, so the meter under
// the stream shows what the selected call has spent without
// rescanning the raw event list on each render or event.
export type CallUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  ttsChars: number;
};
export type CallVoices = { engine: string; voices: Record<string, string> };

export type CallState = {
  callSid: string;
  from: string | null;
  language: string;
  startedAt: string;
  turns: Turn[];
  ended: { reason: string; durationMs: number } | null;
  lastEventAt: string;
  usage: CallUsage;
  voices: CallVoices | null;
};

let seq = 0;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
export function applyEvent(calls: Record<string, CallState>, e: VoiceEvent, fallbackLang: string) {
  const sid = e.callSid;
  if (!sid) return calls;
  const p = e.payload ?? {};
  const prev: CallState = calls[sid] ?? {
    callSid: sid,
    from: null,
    language: fallbackLang,
    startedAt: e.timestamp,
    turns: [],
    ended: null,
    lastEventAt: e.timestamp,
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, ttsChars: 0 },
    voices: null,
  };
  const c: CallState = { ...prev, turns: prev.turns, lastEventAt: e.timestamp };
  const turns = [...c.turns];
  const last = turns[turns.length - 1];

  switch (e.type) {
    case "call.started": {
      c.from = str(p.from) || c.from;
      c.language = str(p.language) || c.language;
      c.startedAt = str(p.startedAt) || e.timestamp;
      c.voices = readVoices(p.voices) ?? c.voices;
      const g = str(p.welcomeGreeting);
      c.usage = { ...c.usage, ttsChars: c.usage.ttsChars + g.length };
      if (g && !turns.some((t) => t.role === "agent"))
        turns.unshift({ id: ++seq, role: "agent", text: g, done: true, at: e.timestamp });
      break;
    }
    case "language.changed":
      c.language = str(p.to) || c.language;
      break;
    case "model.stream.end":
      c.usage = addTokens(c.usage, p.usage);
      break;
    case "transcript.normalized": {
      c.usage = addTokens(c.usage, p.usage);
      const idx = turns.findIndex(
        (turn) =>
          turn.role === "caller" && turn.promptId === p.promptId && typeof p.promptId === "string",
      );
      if (idx >= 0 && typeof p.normalized === "string") {
        turns[idx] = { ...turns[idx], normalized: p.normalized };
      }
      break;
    }
    case "call.ended":
      c.ended = { reason: str(p.reason) || "ended", durationMs: Number(p.durationMs) || 0 };
      if (last && !last.done) turns[turns.length - 1] = { ...last, done: true };
      break;
    case "twilio.inbound": {
      if (p.type === "setup") c.from = str(p.from) || c.from;
      if (p.type === "prompt" && p.last === true) {
        const text = str(p.voicePrompt);
        if (text.trim())
          turns.push({
            id: ++seq,
            role: "caller",
            text,
            done: true,
            at: e.timestamp,
            promptId: str(p.promptId) || undefined,
            language: str(p.lang) || undefined,
          });
      }
      if (p.type === "interrupt") {
        const idx = findLastAgent(turns);
        if (idx >= 0) {
          const heard = str(p.utteranceUntilInterrupt).trim();
          if (heard) turns[idx] = { ...turns[idx], text: heard, done: true, interrupted: true };
          else turns.splice(idx, 1);
        }
      }
      break;
    }
    case "twilio.outbound": {
      if (p.type === "text") {
        const token = str(p.token);
        c.usage = { ...c.usage, ttsChars: c.usage.ttsChars + str(p.spoken ?? p.token).length };
        if (last && last.role === "agent" && !last.done)
          turns[turns.length - 1] = { ...last, text: last.text + token, done: p.last === true };
        else if (token || p.last !== true)
          turns.push({
            id: ++seq,
            role: "agent",
            text: token,
            done: p.last === true,
            at: e.timestamp,
          });
      }
      break;
    }
  }
  c.turns = turns;
  return { ...calls, [sid]: c };
}

function findLastAgent(t: Turn[]) {
  for (let i = t.length - 1; i >= 0; i--) if (t[i].role === "agent") return i;
  return -1;
}

// The reply stream and transcript correction both spend model tokens,
// so each response that reports any usage is counted exactly once,
// and a reply cut off before the model answers costs no tokens.
function addTokens(usage: CallUsage, raw: unknown): CallUsage {
  const u = raw as { input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
  if (!u || typeof u !== "object") return usage;
  return {
    ...usage,
    requests: usage.requests + 1,
    inputTokens: usage.inputTokens + (Number(u.input_tokens) || 0),
    outputTokens: usage.outputTokens + (Number(u.output_tokens) || 0),
  };
}

// Each call announces its voices in the call.started event.
// Old servers send none, so the footer falls back to its
// plain language label as it did before this feature.
function readVoices(raw: unknown): CallVoices | null {
  const v = raw as Partial<CallVoices> | null | undefined;
  if (!v || typeof v !== "object" || !v.voices || typeof v.voices !== "object") return null;
  const voices = Object.fromEntries(
    Object.entries(v.voices).map(([slot, voice]) => [slot, str(voice)]),
  );
  return { engine: str(v.engine), voices };
}
