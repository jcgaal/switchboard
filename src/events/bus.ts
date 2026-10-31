import pino from "pino";
import { WebSocket } from "ws";
import { env } from "../config";
import type { VoiceEvent } from "../shared/events";
import { maskCallers } from "./mask";

export const logger = pino({
  level: env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  ...(env.NODE_ENV === "production"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

// Events are logged as newline-delimited JSON in all environments.
// EVENT_REPLAY keeps the last N events in memory, for observers
// who connect late, and it stays off unless it has been set.
const eventLogger = pino({ base: undefined, timestamp: false });
export const observers = new Set<WebSocket>();
const replay: string[] = [];

const replayLimit = () => Math.max(0, Math.floor(Number(env.EVENT_REPLAY) || 0));

// A slow dashboard must never stall a live call or eat its
// memory, so any observer with over 1 MB of unsent data
// gets closed and has to reconnect to keep watching.
const MAX_BUFFERED = 1_048_576;

function deliver(client: WebSocket, text: string): boolean {
  if (client.readyState !== WebSocket.OPEN) return false;
  if (client.bufferedAmount > MAX_BUFFERED) {
    client.close(1013, "Observer is too slow");
    return false;
  }
  client.send(text, (error) => {
    if (error) client.terminate();
  });
  return true;
}

export function recordEvent(
  callSid: string | null,
  type: string,
  payload: Record<string, unknown> = {},
) {
  const event: VoiceEvent = {
    timestamp: new Date().toISOString(),
    callSid,
    type,
    payload: maskCallers(payload),
  };
  eventLogger.info(event);
  const text = JSON.stringify(event);
  const limit = replayLimit();
  if (limit) {
    replay.push(text);
    if (replay.length > limit) replay.splice(0, replay.length - limit);
  }
  for (const client of observers) deliver(client, text);
}

export function addObserver(client: WebSocket) {
  for (const text of replay) {
    if (!deliver(client, text)) return;
  }
  observers.add(client);
}

export function clearReplay() {
  replay.length = 0;
}
