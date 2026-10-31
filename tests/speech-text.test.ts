import { describe, expect, it } from "vitest";
import { pronounce, SpeechTextBuffer } from "../src/session/speech-text";

const pronunciation = { "Example Co": "Example Company" };

const parts = (chunks: string[], map: Record<string, string> = pronunciation) => {
  const buffer = new SpeechTextBuffer(map);
  return [...chunks.map((chunk) => buffer.push(chunk)), buffer.finish()];
};
const stream = (chunks: string[]) =>
  parts(chunks)
    .map((part) => part.spoken)
    .join("");

describe("pronunciation", () => {
  it("rewrites whole terms, case-insensitively", () => {
    expect(pronounce("Thanks for calling example co.", pronunciation)).toBe(
      "Thanks for calling Example Company.",
    );
  });

  it("leaves longer words alone", () => {
    expect(pronounce("Example Company and Example Cola", pronunciation)).toBe(
      "Example Company and Example Cola",
    );
  });

  it("rewrites a term split across chunks", () => {
    expect(stream(["Welcome to Exa", "mple ", "Co, how can I help?"])).toBe(
      "Welcome to Example Company, how can I help?",
    );
  });

  it("rewrites a term at the very end of the stream", () => {
    expect(stream(["This is Example", " Co"])).toBe("This is Example Company");
  });

  it("does not rewrite a prefix that turns into a longer word", () => {
    expect(stream(["Example Co", "mpany is here"])).toBe("Example Company is here");
  });

  it("passes text through when the agent has no rewrites", () => {
    const result = parts(["Exa", "mple Co"], {});
    expect(result.map((part) => part.spoken).join("")).toBe("Example Co");
    expect(result.every((part) => part.spoken === part.written)).toBe(true);
  });

  it("keeps the written form beside the spoken form", () => {
    const result = parts(["Welcome to Exa", "mple ", "Co, how can I help?"]);
    expect(result.map((part) => part.written).join("")).toBe(
      "Welcome to Example Co, how can I help?",
    );
    expect(result.map((part) => part.spoken).join("")).toBe(
      "Welcome to Example Company, how can I help?",
    );
  });

  it("releases each written chunk with its own spoken form", () => {
    for (const part of parts(["Call Example", " Co today or example co", " tomorrow"])) {
      expect(part.spoken).toBe(pronounce(part.written, pronunciation));
    }
  });
});
