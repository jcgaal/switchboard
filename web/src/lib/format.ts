// Turn times show minutes and seconds, which is all a three
// minute call needs, and a timestamp that fails to parse
// renders as dashes instead of throwing an exception.
export function formatClock(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? "--:--"
    : date.toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
}

// Stream headers show the full clock time down to the
// millisecond, since many events from one exchange
// often arrive within one second on the server.
export function formatStamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? "--:--:--"
    : `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

// Durations floor to whole seconds and clamp at zero, so
// clock skew between the server and browser can never
// produce a negative duration for the usage meter.
export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export const callSeconds = (
  call: { startedAt: string; ended: { durationMs: number } | null },
  now: number,
) => (call.ended ? call.ended.durationMs / 1000 : (now - Date.parse(call.startedAt)) / 1000);
