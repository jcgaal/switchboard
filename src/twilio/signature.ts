import type { IncomingMessage } from "node:http";
import twilio from "twilio";
import { env, skipSignature } from "../config";

export function requestHost(request: IncomingMessage): string | undefined {
  // The host comes from the request itself rather than a hardcoded
  // deployment hostname, and any Host value that is not a plain
  // host and an optional port is rejected before it is used.
  const host = request.headers.host;
  return host && /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host) ? host : undefined;
}

export function validSignature(
  request: IncomingMessage,
  path: string,
  params: Record<string, string>,
  websocket = false,
): boolean {
  if (skipSignature()) return true;
  const token = env.TWILIO_AUTH_TOKEN;
  const signature = request.headers["x-twilio-signature"];
  const host = requestHost(request);
  if (!token || !host || typeof signature !== "string") return false;
  try {
    const urls = [`https://${host}${path}`];
    if (websocket) urls.push(`wss://${host}${path}`);
    return urls.some((url) => twilio.validateRequest(token, signature, url, params));
  } catch {
    return false;
  }
}
