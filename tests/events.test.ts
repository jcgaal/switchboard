import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import numbers from "./fixtures/caller-numbers.json";

const agentsDir = path.resolve(import.meta.dirname, "../agents");
const publicDir = mkdtempSync(path.join(tmpdir(), "switchboard-web-"));
writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>dashboard</title>");
writeFileSync(path.join(publicDir, "app.js"), "console.log('dashboard')");

let close = () => {};

// Each server gets fresh modules, so access settings are read
// from the stubbed environment, and every replay buffer is
// empty instead of holding events from an earlier test.
async function boot(settings: Record<string, string> = {}) {
  vi.stubEnv("AGENTS_DIR", agentsDir);
  vi.stubEnv("AGENT", "echo");
  vi.stubEnv("SKIP_TWILIO_SIGNATURE", "true");
  for (const name of ["OBSERVER_TOKEN", "OBSERVER_PUBLIC", "SHOW_CALLER_NUMBERS", "EVENT_REPLAY"]) {
    vi.stubEnv(name, settings[name] ?? "");
  }
  vi.resetModules();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const { createServer } = await import("../src/app");
  const bus = await import("../src/events/bus");
  const server = createServer({ publicDir });
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.close();
    server.closeAllConnections();
  };
  return {
    host,
    bus,
    http: (route: string, init?: RequestInit) =>
      fetch(`http://${host}${route}`, { redirect: "manual", ...init }),
  };
}

afterEach(() => {
  close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type Observer = {
  status: number;
  socket?: WebSocket;
  events: { type: string; payload: Record<string, unknown> }[];
};

function observe(
  host: string,
  query = "",
  headers: Record<string, string> = {},
): Promise<Observer> {
  return new Promise((resolve) => {
    const events: Observer["events"] = [];
    const socket = new WebSocket(`ws://${host}/events${query}`, { headers });
    socket.on("message", (data) => events.push(JSON.parse(String(data))));
    socket.on("open", () => resolve({ status: 101, socket, events }));
    socket.on("unexpected-response", (_request, response) =>
      resolve({ status: response.statusCode ?? 0, events }),
    );
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("observer access", () => {
  it("stays closed without OBSERVER_TOKEN or OBSERVER_PUBLIC", async () => {
    const { host, http } = await boot();
    expect((await observe(host)).status).toBe(403);
    expect((await http("/api/status")).status).toBe(403);
    expect((await http("/")).status).toBe(403);
    expect((await http("/app.js")).status).toBe(403);
  });

  it("refuses unauthenticated and wrong-token observers", async () => {
    const { host, http } = await boot({ OBSERVER_TOKEN: "observer-secret" });
    expect((await observe(host)).status).toBe(401);
    expect((await observe(host, "?token=wrong")).status).toBe(401);
    expect((await http("/api/status")).status).toBe(401);
    expect((await http("/")).status).toBe(401);
    expect(await (await http("/")).text()).not.toContain("observer-secret");
  });

  it("swaps a token in the URL for an HttpOnly cookie", async () => {
    const { host, http } = await boot({ OBSERVER_TOKEN: "observer-secret" });
    const first = await http("/?token=observer-secret&call=1", {
      headers: { accept: "text/html" },
    });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/?call=1");
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(
      /^switchboard_observer=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict/,
    );
    expect(cookie).not.toContain("observer-secret");
    const session = cookie.split(";")[0];
    const page = await http("/", { headers: { cookie: session } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>dashboard</title>");
    expect((await http("/app.js", { headers: { cookie: session } })).status).toBe(200);
    expect((await observe(host, "", { cookie: session })).status).toBe(101);
    expect((await http("/", { headers: { cookie: "switchboard_observer=forged" } })).status).toBe(
      401,
    );
  });

  it("accepts the token in the query or as a bearer header", async () => {
    const { host, http } = await boot({ OBSERVER_TOKEN: "observer-secret" });
    expect((await observe(host, "?token=observer-secret")).status).toBe(101);
    expect((await observe(host, "", { authorization: "Bearer observer-secret" })).status).toBe(101);
    const status = await http("/api/status", {
      headers: { authorization: "Bearer observer-secret" },
    });
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body).toMatchObject({ agent: "echo", signatureValidation: false });
    expect(body.missingSecrets).not.toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(body)).not.toContain("observer-secret");
  });

  it("opens to everyone with OBSERVER_PUBLIC and no token", async () => {
    const { host, http } = await boot({ OBSERVER_PUBLIC: "true" });
    expect((await observe(host)).status).toBe(101);
    expect((await http("/api/status")).status).toBe(200);
    expect((await http("/")).status).toBe(200);
  });

  it("never gates the webhooks or the health check", async () => {
    const { http } = await boot({ OBSERVER_TOKEN: "observer-secret" });
    expect((await http("/health")).status).toBe(200);
    const voice = await http("/voice?stage=connect", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "CallSid=CAtest&From=%2B15550101&To=%2B15550100",
    });
    expect(voice.status).toBe(200);
    expect(await voice.text()).toContain("<ConversationRelay");
  });
});

describe("caller masking", () => {
  it("masks caller numbers in events sent to observers", async () => {
    const { host, bus } = await boot({ OBSERVER_PUBLIC: "true" });
    const observer = await observe(host);
    bus.recordEvent("CAtest", "call.started", {
      from: numbers.mexico.number,
      to: "+15550100",
      nested: { From: "+15550101" },
    });
    await settle();
    expect(observer.events[0].payload).toEqual({
      from: numbers.mexico.masked,
      to: "+15550100",
      nested: { From: "+1 ••• ••• 0101" },
    });
  });

  it("masks numbers in the event log line", async () => {
    const { bus } = await boot({ OBSERVER_PUBLIC: "true" });
    const write = vi.mocked(process.stdout.write);
    bus.recordEvent("CAtest", "webhook.received", { from: "+15550101" });
    const logged = write.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).toContain('"type":"webhook.received"');
    expect(logged).toContain("+1 ••• ••• 0101");
    expect(logged).not.toContain("15550101");
  });

  it("shows full numbers with SHOW_CALLER_NUMBERS", async () => {
    const { host, bus } = await boot({ OBSERVER_PUBLIC: "true", SHOW_CALLER_NUMBERS: "true" });
    const observer = await observe(host);
    bus.recordEvent("CAtest", "call.started", { from: "+15550101" });
    await settle();
    expect(observer.events[0].payload.from).toBe("+15550101");
  });

  it("formats country codes and leaves non-numbers alone", async () => {
    const { maskNumber } = await import("../src/events/mask");
    expect(maskNumber("+15550101")).toBe("+1 ••• ••• 0101");
    for (const { number, masked } of Object.values(numbers))
      expect(maskNumber(number)).toBe(masked);
    expect(maskNumber("5550100142")).toBe("••• ••• 0142");
    expect(maskNumber("anonymous")).toBe("anonymous");
    expect(maskNumber("client:alice")).toBe("client:alice");
  });
});

describe("observer stream", () => {
  it("sends nothing from before the connection by default", async () => {
    const { host, bus } = await boot({ OBSERVER_PUBLIC: "true" });
    bus.recordEvent(null, "voice.settings", { n: 1 });
    const observer = await observe(host);
    bus.recordEvent(null, "voice.settings", { n: 2 });
    await settle();
    expect(observer.events.map((event) => event.payload.n)).toEqual([2]);
  });

  it("replays the last EVENT_REPLAY events to a new observer", async () => {
    const { host, bus } = await boot({ OBSERVER_PUBLIC: "true", EVENT_REPLAY: "2" });
    for (const n of [1, 2, 3]) bus.recordEvent(null, "voice.settings", { n });
    const observer = await observe(host);
    bus.recordEvent(null, "voice.settings", { n: 4 });
    await settle();
    expect(observer.events.map((event) => event.payload.n)).toEqual([2, 3, 4]);
  });

  it("ignores anything an observer sends", async () => {
    const { host, bus } = await boot({ OBSERVER_PUBLIC: "true" });
    const observer = await observe(host);
    observer.socket!.send(JSON.stringify({ type: "voice.settings", payload: {} }));
    await settle();
    bus.recordEvent(null, "call.ended", {});
    await settle();
    expect(observer.events.map((event) => event.type)).toEqual(["call.ended"]);
  });

  it("closes an observer holding more than 1 MB of unsent data", async () => {
    const { bus } = await boot({ OBSERVER_PUBLIC: "true" });
    const slow = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 1_048_577,
      close: vi.fn(),
      send: vi.fn(),
    };
    const fast = { readyState: WebSocket.OPEN, bufferedAmount: 0, close: vi.fn(), send: vi.fn() };
    bus.addObserver(slow as never);
    bus.addObserver(fast as never);
    bus.recordEvent(null, "voice.settings", {});
    expect(slow.close).toHaveBeenCalledWith(1013, "Observer is too slow");
    expect(slow.send).not.toHaveBeenCalled();
    expect(fast.send).toHaveBeenCalledOnce();
    bus.observers.clear();
  });
});
