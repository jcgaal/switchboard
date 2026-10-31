import { env } from "../config";

const DEFAULT_MAX_CALLS = 10;

const live = new Set<object>();
const idle: Array<() => void> = [];
let draining = false;
let limit: number | undefined;

// A public number lets anyone open calls that spend model tokens,
// so the cap is on by default. Zero turns it off for any hosts
// with limits of their own, and a bad value stops the boot.
export function maxConcurrentCalls(): number {
  if (limit !== undefined) return limit;
  const raw = env.MAX_CONCURRENT_CALLS?.trim();
  if (!raw) return (limit = DEFAULT_MAX_CALLS);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`MAX_CONCURRENT_CALLS must be a whole number of 0 or more, got "${raw}"`);
  }
  return (limit = value);
}

export function callOpened(call: object) {
  live.add(call);
}

export function callClosed(call: object) {
  live.delete(call);
  if (live.size === 0) idle.splice(0).forEach((resolve) => resolve());
}

export function liveCallCount(): number {
  return live.size;
}

// New calls get a busy signal while the server drains for a
// restart or once the cap is reached. Rejected calls are
// not billed by Twilio, and the caller can try again.
export function refusal(): "draining" | "busy" | null {
  if (draining) return "draining";
  const max = maxConcurrentCalls();
  return max > 0 && live.size >= max ? "busy" : null;
}

export function drain(): Promise<void> {
  draining = true;
  if (live.size === 0) return Promise.resolve();
  return new Promise((resolve) => idle.push(resolve));
}
