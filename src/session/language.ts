type ParsedChunk = {
  language?: string;
  text: string;
  tagMissing?: string;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Streaming deltas can split the language tag across chunks,
// so text is held back until the tag parses. A reply with
// no tag at all is still spoken rather than discarded.
export class LanguageTagParser {
  private buffer = "";
  private resolved = false;
  private readonly tags: Map<string, string>;
  private readonly known: RegExp;

  // Tags map to the agent locales, such as en to en-US. Any
  // bracketed tag the agent doesn't list is removed too,
  // so it is never read aloud on the call by mistake.
  constructor(tags: Record<string, string>) {
    this.tags = new Map(Object.entries(tags).map(([tag, locale]) => [tag.toLowerCase(), locale]));
    const names = [...this.tags.keys()].sort((a, b) => b.length - a.length).map(escape);
    this.known = new RegExp(`^\\[\\s*(${names.join("|") || "(?!)"})\\s*\\]`, "i");
  }

  push(chunk: string): ParsedChunk {
    if (this.resolved) return { text: chunk };
    this.buffer += chunk;
    const candidate = this.buffer.trimStart();
    const match = this.known.exec(candidate);
    if (match) {
      this.resolved = true;
      this.buffer = "";
      return {
        language: this.tags.get(match[1].toLowerCase()),
        text: candidate.slice(match[0].length),
      };
    }
    const unknown = /^\[\s*([a-z]{2,3}(?:-[a-z]{2})?)\s*\]/i.exec(candidate);
    if (unknown) {
      this.resolved = true;
      this.buffer = "";
      return {
        text: candidate.slice(unknown[0].length),
        tagMissing: `Unknown language tag [${unknown[1]}]`,
      };
    }
    if (this.buffer.replace(/\s/g, "").length >= 10) {
      return this.resolveMissingTag();
    }
    return { text: "" };
  }

  finish(): ParsedChunk {
    return this.resolved ? { text: "" } : this.resolveMissingTag();
  }

  private resolveMissingTag(): ParsedChunk {
    this.resolved = true;
    const text = this.buffer;
    this.buffer = "";
    return { text, tagMissing: "No language tag in the first 10 non-whitespace characters" };
  }
}
