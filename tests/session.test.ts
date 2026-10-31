import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamRequest } from "../src/models/types";

const agentsDir = path.resolve(import.meta.dirname, "../agents");

type Chunk = { text?: string; usage?: { inputTokens: number; outputTokens: number } };
type Script = (request: StreamRequest) => AsyncIterable<Chunk>;

// The socket stands in for ConversationRelay. It records every
// frame that the session sends, and lets a test push frames
// that Twilio would send, without a network or a server.
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  closed?: string;
  send(data: string, callback?: (error?: Error) => void) {
    this.sent.push(JSON.parse(data));
    callback?.();
  }
  close(_code: number, reason: string) {
    this.readyState = 3;
    this.closed = reason;
    this.emit("close");
  }
  receive(message: Record<string, unknown>) {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
  texts() {
    return this.sent.filter((frame) => frame.type === "text");
  }
}

const reply = (...chunks: Chunk[]): Script =>
  async function* () {
    for (const chunk of chunks) yield chunk;
  };

// A reply that waits for the abort signal, so tests can cut it
// off with a new prompt or an interrupt while it is running
// just the way a caller talking over the agent would do.
const hang = (...chunks: Chunk[]): Script =>
  async function* ({ signal }) {
    for (const chunk of chunks) yield chunk;
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  };

let teardown = () => {};

async function boot(agent: string, scripts: Script[] = []) {
  vi.stubEnv("AGENTS_DIR", agentsDir);
  vi.stubEnv("AGENT", agent);
  vi.resetModules();
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const requests: StreamRequest[] = [];
  let active = 0;
  let overlap = false;
  vi.doMock("../src/events/bus", () => ({
    recordEvent: (_sid: string | null, type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload }),
  }));
  vi.doMock("../src/models/registry", () => ({
    fastModel: () => null,
    model: () => ({
      id: "fake:model",
      complete: async () => ({ text: "" }),
      async *stream(request: StreamRequest) {
        requests.push({ ...request, messages: request.messages.map((turn) => ({ ...turn })) });
        if (++active > 1) overlap = true;
        try {
          const script = scripts.shift();
          if (!script) throw new Error("No scripted reply left");
          yield* script(request);
        } finally {
          active--;
        }
      },
    }),
  }));
  const { CallSession } = await import("../src/session/call-session");
  const socket = new FakeSocket();
  new CallSession(socket as never);
  teardown = () => socket.readyState === 1 && socket.close(1000, "test_done");
  return {
    socket,
    events,
    requests,
    overlap: () => overlap,
    types: () => events.map((event) => event.type),
  };
}

afterEach(() => {
  teardown();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock("../src/events/bus");
  vi.doUnmock("../src/models/registry");
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const setup = (parameters: Record<string, string> = {}) => ({
  type: "setup",
  callSid: "CAtest",
  from: "+15550101",
  to: "+15550100",
  customParameters: parameters,
});
const prompt = (text: string, last = true) => ({
  type: "prompt",
  voicePrompt: text,
  lang: "en-US",
  last,
});
const intakeParameters = {
  initialLanguage: "en-US",
  voiceEngine: "neural",
  "voice.en-US": "Amazon:Brian-Neural",
  "locale.en-US": "en-GB",
  "voice.es-MX": "Amazon:Sergio-Neural",
  "locale.es-MX": "es-ES",
};

describe("echo agent", () => {
  it("repeats each final prompt and ends every cycle with an empty last frame", async () => {
    const { socket, events, types } = await boot("echo");
    socket.receive(setup());
    socket.receive(prompt("Hello th", false));
    socket.receive(prompt("Hello there"));
    await settle();
    expect(socket.texts()).toEqual([
      { type: "text", token: "Hello there", last: false },
      { type: "text", token: "", last: true },
    ]);
    expect(types()).toContain("call.started");
    expect(events.find((event) => event.type === "model.request.start")?.payload.model).toBe(
      "echo",
    );
    expect(events.find((event) => event.type === "model.stream.end")?.payload).toMatchObject({
      model: "echo",
      interrupted: false,
    });
    expect(
      events.find((event) => event.type === "twilio.inbound" && event.payload.last === true)
        ?.payload.promptId,
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ignores prompts before setup and empty prompts", async () => {
    const { socket } = await boot("echo");
    socket.receive(prompt("too early"));
    socket.receive(setup());
    socket.receive(prompt("   "));
    await settle();
    expect(socket.texts()).toEqual([]);
  });
});

describe("model agent", () => {
  it("records the call voices and starts in the initial language", async () => {
    const { socket, events } = await boot("intake");
    socket.receive(setup(intakeParameters));
    expect(events.find((event) => event.type === "call.started")?.payload).toMatchObject({
      language: "en-US",
      voices: {
        engine: "neural",
        voices: { "en-US": "Amazon:Brian-Neural", "es-MX": "Amazon:Sergio-Neural" },
      },
    });
  });

  it("falls back to the agent default language for an unknown initial language", async () => {
    const { socket, events } = await boot("intake");
    socket.receive(setup({ initialLanguage: "fr-FR" }));
    expect(events.find((event) => event.type === "call.started")?.payload.language).toBe("es-MX");
  });

  it("speaks the spoken form while events and history keep the written form", async () => {
    const { socket, events, requests } = await boot("intake", [
      reply(
        { text: "[en] Welcome to Exa" },
        { text: "mple Co. Who" },
        { text: " is calling?" },
        { usage: { inputTokens: 30, outputTokens: 9 } },
      ),
      reply({ text: "[en] Thanks." }),
    ]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("Hi there"));
    await settle();
    const spoken = socket
      .texts()
      .map((frame) => frame.token)
      .join("");
    expect(spoken).toBe(" Welcome to Example Company. Who is calling?");
    const outbound = events.filter(
      (event) => event.type === "twilio.outbound" && event.payload.type === "text",
    );
    expect(outbound.map((event) => event.payload.token).join("")).toBe(
      " Welcome to Example Co. Who is calling?",
    );
    expect(outbound.map((event) => event.payload.spoken ?? event.payload.token).join("")).toBe(
      spoken,
    );
    expect(outbound.some((event) => event.payload.spoken)).toBe(true);
    expect(events.find((event) => event.type === "model.stream.end")?.payload).toEqual({
      durationMs: expect.any(Number),
      model: "fake:model",
      usage: { input_tokens: 30, output_tokens: 9 },
      interrupted: false,
    });
    socket.receive(prompt("This is Ana"));
    await settle();
    expect(requests[1].messages).toEqual([
      { role: "user", content: "Hi there" },
      { role: "assistant", content: " Welcome to Example Co. Who is calling?" },
      { role: "user", content: "This is Ana" },
    ]);
    expect(requests[0].system).toContain("The current language of this call is en-US.");
    expect(requests[0].system).toContain("[en] for en-US, [es] for es-MX");
  });

  it("switches language and announces the locale of the slot's voice", async () => {
    const { socket, events } = await boot("intake", [
      reply({ text: "[es] Claro, " }, { text: "seguimos en español." }),
    ]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("Can we speak Spanish?"));
    await settle();
    expect(socket.sent.filter((frame) => frame.type === "language")).toEqual([
      { type: "language", ttsLanguage: "es-ES" },
    ]);
    expect(events.find((event) => event.type === "language.changed")?.payload).toEqual({
      from: "en-US",
      to: "es-MX",
    });
  });

  it("reports a missing tag and still speaks the reply", async () => {
    const { socket, events } = await boot("intake", [reply({ text: "Sure, go ahead please." })]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("Hello"));
    await settle();
    expect(
      socket
        .texts()
        .map((frame) => frame.token)
        .join(""),
    ).toBe("Sure, go ahead please.");
    expect(events.map((event) => event.type)).toContain("language.tag_missing");
  });

  it("cancels the active reply on a new prompt and never overlaps streams", async () => {
    const { socket, events, overlap } = await boot("intake", [
      hang({ text: "[en] Let me think" }),
      reply({ text: "[en] Done." }),
    ]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("First question"));
    await settle();
    socket.receive(prompt("Actually, second question"));
    await settle();
    const ends = events
      .filter((event) => event.type === "model.stream.end")
      .map((event) => event.payload.interrupted);
    expect(ends).toEqual([true, false]);
    expect(socket.texts().filter((frame) => frame.last === true)).toHaveLength(2);
    expect(overlap()).toBe(false);
  });

  it("keeps only what the caller heard after an interruption", async () => {
    const { socket, requests } = await boot("intake", [
      hang({ text: "[en] Welcome to Example Co, the best" }),
      hang({ text: "[en] Sorry, go on" }),
      reply({ text: "[en] Okay." }),
    ]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("Hello"));
    await settle();
    socket.receive({
      type: "interrupt",
      utteranceUntilInterrupt: "Welcome to",
      durationUntilInterruptMs: 500,
    });
    socket.receive(prompt("Wait"));
    await settle();
    expect(requests[1].messages.at(-2)).toEqual({ role: "assistant", content: "Welcome to" });
    socket.receive({ type: "interrupt", utteranceUntilInterrupt: "" });
    socket.receive(prompt("Again"));
    await settle();
    expect(requests[2].messages.map((turn) => turn.role)).toEqual([
      "user",
      "assistant",
      "user",
      "user",
    ]);
    expect(socket.texts().filter((frame) => frame.last === true)).toHaveLength(3);
  });

  it("speaks the apology and records error.model when the model fails", async () => {
    const { socket, events } = await boot("intake", [
      async function* () {
        yield { text: "[en] Hm" };
        throw new Error("upstream broke");
      },
    ]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("Hello"));
    await settle();
    expect(events.find((event) => event.type === "error.model")?.payload).toEqual({
      model: "fake:model",
      message: "upstream broke",
    });
    expect(
      socket
        .texts()
        .map((frame) => frame.token)
        .join(""),
    ).toContain("Sorry, something went wrong.");
    expect(socket.texts().at(-1)).toEqual({ type: "text", token: "", last: true });
    expect(events.map((event) => event.type)).not.toContain("error.claude");
  });
});

describe("timers", () => {
  it("closes the call at the time limit with the closing line", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { socket, events } = await boot("intake", [hang({ text: "[en] Still talking" })]);
    socket.receive(setup(intakeParameters));
    socket.receive(prompt("Hello"));
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(180_000);
    const frames = socket.sent;
    expect(frames.at(-2)).toEqual({
      type: "text",
      token: "We've reached the time limit. Thanks for calling.",
      last: true,
    });
    expect(frames.at(-1)).toEqual({ type: "end" });
    expect(frames.filter((frame) => frame.type === "text" && frame.last === true)).toHaveLength(2);
    expect(events.find((event) => event.type === "call.ended")?.payload).toMatchObject({
      reason: "time_limit",
    });
    expect(socket.closed).toBe("time_limit");
  });

  it("ends a call whose setup never arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { socket, events } = await boot("echo");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.find((event) => event.type === "call.ended")?.payload).toMatchObject({
      reason: "setup_timeout",
    });
    expect(socket.closed).toBe("setup_timeout");
  });
});
