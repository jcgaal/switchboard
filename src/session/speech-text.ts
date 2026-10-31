export type Pronunciation = Record<string, string>;
export type SpeechText = { written: string; spoken: string };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pattern(pronunciation: Pronunciation): RegExp | null {
  const written = Object.keys(pronunciation).sort((a, b) => b.length - a.length);
  if (!written.length) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${written.map(escape).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
}

export function pronounce(text: string, pronunciation: Pronunciation): string {
  const regex = pattern(pronunciation);
  if (!regex) return text;
  const spoken = new Map(
    Object.entries(pronunciation).map(([from, to]) => [from.toLowerCase(), to]),
  );
  return text.replace(regex, (match) => spoken.get(match.toLowerCase()) ?? match);
}

// Text that might be the start of a written term is held back
// until the next delta, so that a term split across chunks
// is still rewritten whole, and only whole words match.
export class SpeechTextBuffer {
  private pending = "";
  private previous = "";
  private readonly regex: RegExp | null;
  private readonly spoken: Map<string, string>;
  private readonly written: string[];

  constructor(pronunciation: Pronunciation = {}) {
    this.regex = pattern(pronunciation);
    this.spoken = new Map(
      Object.entries(pronunciation).map(([from, to]) => [from.toLowerCase(), to]),
    );
    this.written = [...this.spoken.keys()];
  }

  push(chunk: string): SpeechText {
    const text = this.pending + chunk;
    if (!this.regex) return { written: text, spoken: text };
    let held = 0;
    const lower = text.toLowerCase();
    for (const term of this.written) {
      for (let length = Math.min(term.length, lower.length); length > held; length--) {
        if (term.startsWith(lower.slice(-length))) {
          held = length;
          break;
        }
      }
    }
    const released = text.slice(0, text.length - held);
    this.pending = text.slice(text.length - held);
    return { written: released, spoken: this.rewrite(released, this.pending) };
  }

  finish(): SpeechText {
    const written = this.pending;
    const spoken = this.regex ? this.rewrite(written, "") : written;
    this.pending = "";
    return { written, spoken };
  }

  // The character before and the held text after are passed
  // to the matcher, only as context for word boundaries,
  // and neither of these ever shows up in the output.
  private rewrite(text: string, following: string): string {
    if (!text) return "";
    const context = this.previous + text + following;
    const start = this.previous.length;
    const end = start + text.length;
    let output = "";
    let cursor = start;
    for (const match of context.matchAll(this.regex!)) {
      const from = match.index;
      const to = from + match[0].length;
      if (from < start || to > end) continue;
      output += context.slice(cursor, from) + (this.spoken.get(match[0].toLowerCase()) ?? match[0]);
      cursor = to;
    }
    output += context.slice(cursor, end);
    this.previous = text.slice(-1);
    return output;
  }
}
