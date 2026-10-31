import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { agent, agentLanguage, languageForNumber } from "../agents/load";
import { recordEvent } from "../events/bus";
import { callClosed, callOpened } from "./capacity";
import { LanguageTagParser } from "./language";
import { pronounce, SpeechTextBuffer, type SpeechText } from "./speech-text";
import { model as modelAdapter } from "../models/registry";
import { ModelError, type Turn, type Usage } from "../models/types";
import { normalizeTranscript } from "../normalize/transcript";
import { parseInbound, type Inbound, type Outbound } from "../twilio/relay";

type Generation = {
  controller: AbortController;
  finish: () => void;
  heardTurn?: Turn;
};

function messageText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

// The agent prompt is followed by blocks that every agent
// needs, so authors never write the language tag rules
// or repeat the hints that transcription also uses.
function systemPrompt(language: string): string {
  const { prompt, languages, transcription } = agent();
  const current = languages[language] ? language : agent().default_language;
  const tags = Object.entries(languages).map(([locale, { tag }]) => `[${tag}] for ${locale}`);
  const blocks = [
    prompt,
    [
      `The current language of this call is ${current}. Reply in it.`,
      Object.keys(languages).length > 1
        ? `Switch language only when the caller asks to continue in another one. Supported: ${Object.keys(languages).join(", ")}.`
        : "",
      `Start every reply with the language tag in square brackets and nothing before it: ${tags.join(", ")}.`,
      "The tag is metadata and is not spoken.",
    ]
      .filter(Boolean)
      .join(" "),
  ];
  if (transcription.hints.length) {
    blocks.push(
      `Reference vocabulary for names the caller may say. These are not assumed answers or a closed list: ${transcription.hints.join(", ")}.`,
    );
  }
  return blocks.join("\n\n");
}

export class CallSession {
  private callSid: string | null = null;
  private history: Turn[] = [];
  private language = "";
  private ttsLocales: Record<string, string> = {};
  private startedAt = 0;
  private timer?: NodeJS.Timeout;
  private setupTimer: NodeJS.Timeout;
  private active?: Generation;
  private latestAssistant?: Turn;
  private queue = Promise.resolve();
  private ended = false;

  constructor(private socket: WebSocket) {
    callOpened(this);
    this.setupTimer = setTimeout(() => {
      if (!this.startedAt) this.end("setup_timeout");
    }, 10_000);
    socket.on("message", (raw) => {
      try {
        const parsed = parseInbound(raw.toString());
        if (!parsed.ok) throw new Error(parsed.reason);
        this.receive(parsed.message, parsed.raw);
      } catch {
        recordEvent(this.callSid, "error.message", { reason: "Invalid Twilio message" });
      }
    });
    socket.on("close", () => this.end("socket_closed"));
    socket.on("error", () => {
      recordEvent(this.callSid, "error.socket", { reason: "Call WebSocket error" });
      this.end("socket_error");
    });
  }

  private send(message: Outbound, event: Record<string, unknown> = message) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    recordEvent(this.callSid, "twilio.outbound", event);
    this.socket.send(JSON.stringify(message), (error) => {
      if (error) this.end("send_error");
    });
  }

  // Twilio gets the spoken form, while the event keeps the
  // written token. Dashboards show what the model wrote
  // and see the spoken form only where those differ.
  private sendText({ written, spoken }: SpeechText, last: boolean) {
    const event = { type: "text", token: written, last, ...(spoken !== written ? { spoken } : {}) };
    this.send({ type: "text", token: spoken, last }, event);
  }

  private cancelGeneration() {
    this.active?.controller.abort();
    // Close out the previous talk cycle before a new cycle or
    // the closing line starts, so each turn that observers
    // see in the event stream has a start and a finish.
    this.active?.finish();
  }

  private receive(message: Inbound, raw: Record<string, unknown>) {
    const inboundSid =
      message.type === "setup" && message.callSid !== undefined ? message.callSid : this.callSid;
    // These ids exist only for observers. They keep repeated
    // text, and corrections arriving out of order, pinned
    // to their turn in the stream that observers read.
    const promptId = message.type === "prompt" && message.last === true ? randomUUID() : undefined;
    recordEvent(inboundSid, "twilio.inbound", promptId ? { ...raw, promptId } : raw);
    if (this.ended) return;
    switch (message.type) {
      case "setup": {
        if (this.startedAt || !message.callSid) {
          recordEvent(this.callSid, "error.setup", { reason: "Invalid or duplicate setup" });
          return;
        }
        clearTimeout(this.setupTimer);
        this.callSid = message.callSid;
        this.startedAt = Date.now();
        this.history = [];
        const parameters = message.customParameters;
        const initial = parameters?.initialLanguage;
        this.language =
          typeof initial === "string" && agent().languages[initial]
            ? initial
            : languageForNumber(message.to);
        // TwiML registers each voice by locale, so a language switch
        // names that locale, while the agent goes on reasoning in
        // the languages that are listed in its own agent file.
        const param = (name: string) =>
          typeof parameters?.[name] === "string" ? (parameters[name] as string) : "";
        const slots = Object.keys(agent().languages);
        this.ttsLocales = Object.fromEntries(
          slots.map((slot) => [slot, param(`locale.${slot}`) || slot]),
        );
        recordEvent(this.callSid, "call.started", {
          voices: {
            engine: param("voiceEngine"),
            voices: Object.fromEntries(
              slots.flatMap((slot) =>
                param(`voice.${slot}`) ? [[slot, param(`voice.${slot}`)]] : [],
              ),
            ),
          },
          from: message.from ?? "",
          language: this.language,
          startedAt: new Date(this.startedAt).toISOString(),
          to: message.to ?? "",
          welcomeGreeting: agentLanguage(this.language).greeting,
        });
        this.timer = setTimeout(() => this.end("time_limit"), agent().time_limit_seconds * 1000);
        break;
      }
      case "prompt": {
        if (!this.startedAt || message.last !== true || !message.voicePrompt?.trim()) return;
        const text = message.voicePrompt;
        this.cancelGeneration();
        const previousAgentQuestion =
          [...this.history].reverse().find((turn) => turn.role === "assistant")?.content ||
          agentLanguage(this.language).greeting;
        if (agent().responder === "model") {
          void normalizeTranscript(this.callSid, promptId!, text, previousAgentQuestion);
        }
        this.queue = this.queue
          .then(async () => {
            if (this.ended) return;
            this.history.push({ role: "user", content: text });
            await this.reply();
          })
          .catch(() => {
            recordEvent(this.callSid, "error.queue", { reason: "Conversation processing failed" });
          });
        break;
      }
      case "interrupt": {
        this.cancelGeneration();
        const heard = message.utteranceUntilInterrupt ?? "";
        const turn = this.latestAssistant;
        if (turn) {
          if (heard) turn.content = heard;
          else this.history = this.history.filter((entry) => entry !== turn);
        }
        recordEvent(this.callSid, "call.interrupted", { utteranceUntilInterrupt: heard });
        break;
      }
      case "error":
        recordEvent(this.callSid, "error.twilio", { description: message.description });
        break;
      case "dtmf":
      case "unknown":
        recordEvent(this.callSid, "twilio.ignored", { type: raw.type });
    }
  }

  private async reply() {
    const started = Date.now();
    const controller = new AbortController();
    const speechText = new SpeechTextBuffer(agent().pronunciation);
    let finalized = false;
    const generation: Generation = {
      controller,
      finish: () => {
        if (finalized) return;
        finalized = true;
        if (!controller.signal.aborted && !this.ended) {
          emitText(speechText.finish());
        }
        this.sendText({ written: "", spoken: "" }, true);
      },
    };
    this.active = generation;
    this.latestAssistant = undefined;
    let usage: Usage | null = null;
    const model = agent().responder === "echo" ? "echo" : modelAdapter().id;
    recordEvent(this.callSid, "model.request.start", {
      model,
      turnCount: this.history.length,
      language: this.language,
    });
    const emitText = (text: SpeechText) => {
      if (!text.written || controller.signal.aborted || this.ended) return;
      if (!generation.heardTurn) {
        generation.heardTurn = { role: "assistant", content: "" };
        this.latestAssistant = generation.heardTurn;
        this.history.push(generation.heardTurn);
      }
      generation.heardTurn.content += text.written;
      this.sendText(text, false);
    };
    const appendText = (text: string) => emitText(speechText.push(text));
    try {
      if (agent().responder === "echo") {
        appendText(this.history[this.history.length - 1]?.content ?? "");
        return;
      }
      // Copy the history first, because this reply appends a
      // partial assistant turn which must never leak into
      // the shared conversation when the stream fails.
      const stream = modelAdapter().stream({
        system: systemPrompt(this.language),
        messages: this.history.map((turn) => ({ ...turn })),
        maxTokens: agent().max_reply_tokens,
        signal: controller.signal,
      });
      const parser = new LanguageTagParser(
        Object.fromEntries(
          Object.entries(agent().languages).map(([locale, { tag }]) => [tag, locale]),
        ),
      );
      for await (const chunk of stream) {
        if (controller.signal.aborted || this.ended) break;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.text) {
          const parsed = parser.push(chunk.text);
          if (parsed.tagMissing) {
            recordEvent(this.callSid, "language.tag_missing", {
              language: this.language,
              reason: parsed.tagMissing,
            });
          }
          if (parsed.language && parsed.language !== this.language) {
            const previous = this.language;
            this.language = parsed.language;
            this.send({
              type: "language",
              ttsLanguage: this.ttsLocales[this.language] ?? this.language,
            });
            recordEvent(this.callSid, "language.changed", { from: previous, to: this.language });
          }
          appendText(parsed.text);
        }
      }
      if (!controller.signal.aborted && !this.ended) {
        const remaining = parser.finish();
        if (remaining.tagMissing) {
          recordEvent(this.callSid, "language.tag_missing", {
            language: this.language,
            reason: remaining.tagMissing,
          });
        }
        appendText(remaining.text);
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.ended) {
        recordEvent(
          this.callSid,
          "error.model",
          error instanceof ModelError
            ? { model, status: error.status, errorType: error.type, message: error.message }
            : { model, message: messageText(error) },
        );
        appendText(agentLanguage(this.language).error_apology);
      }
    } finally {
      // Always finalize, including aborted and errored streams.
      // finish() is idempotent, so calling it after a cancel
      // that already finished the stream is a safe no-op.
      generation.finish();
      recordEvent(this.callSid, "model.stream.end", {
        durationMs: Date.now() - started,
        model,
        usage: usage && { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
        interrupted: controller.signal.aborted,
      });
      if (this.active === generation) this.active = undefined;
    }
  }

  private end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    callClosed(this);
    clearTimeout(this.setupTimer);
    clearTimeout(this.timer);
    this.cancelGeneration();
    if (reason === "time_limit") {
      const closing = agentLanguage(this.language).closing_time_limit;
      this.sendText({ written: closing, spoken: pronounce(closing, agent().pronunciation) }, true);
      this.send({ type: "end" });
    }
    recordEvent(this.callSid, "call.ended", {
      reason,
      durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
    });
    this.history = [];
    this.latestAssistant = undefined;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, reason);
  }
}
