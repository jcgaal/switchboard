import { env } from "../config";

// Country codes have one, two or three digits. These are all
// the one- and two-digit codes, and every other number is
// read as having a three-digit code, the way ITU does.
const SHORT_CODES = new Set([
  "1",
  "7",
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

export function maskNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return value;
  const code = value.trim().startsWith("+")
    ? ([1, 2].map((length) => digits.slice(0, length)).find((prefix) => SHORT_CODES.has(prefix)) ??
      digits.slice(0, 3))
    : "";
  return `${code ? `+${code} ` : ""}••• ••• ${digits.slice(-4)}`;
}

const CALLER_FIELDS = new Set(["from", "From", "caller", "Caller"]);

// Caller numbers are masked before an event is logged or sent,
// including nested payloads, so no observer, log, or replay
// buffer holds a full number unless that is switched on.
export function maskCallers<T>(value: T, depth = 0): T {
  if (env.SHOW_CALLER_NUMBERS === "true" || depth > 4 || !value || typeof value !== "object")
    return value;
  if (Array.isArray(value)) return value.map((item) => maskCallers(item, depth + 1)) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      CALLER_FIELDS.has(key) && typeof item === "string"
        ? maskNumber(item)
        : maskCallers(item, depth + 1),
    ]),
  ) as T;
}
