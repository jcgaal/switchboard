import { describe, expect, it } from "vitest";
import { LanguageTagParser } from "../src/session/language";

const tags = { en: "en-US", es: "es-MX" };

const parse = (chunks: string[], map: Record<string, string> = tags) => {
  const parser = new LanguageTagParser(map);
  const results = [...chunks.map((chunk) => parser.push(chunk)), parser.finish()];
  return {
    language: results.find((result) => result.language)?.language,
    text: results.map((result) => result.text).join(""),
    missing: results.find((result) => result.tagMissing)?.tagMissing,
  };
};

describe("language tags", () => {
  it("reads a tag at the start of the reply", () => {
    expect(parse(["[es] Hola, ¿cómo está?"])).toEqual({
      language: "es-MX",
      text: " Hola, ¿cómo está?",
      missing: undefined,
    });
  });

  it("reads a tag split across chunks", () => {
    expect(parse(["[", "e", "n] Hello", " there"])).toMatchObject({
      language: "en-US",
      text: " Hello there",
    });
  });

  it("ignores case and whitespace", () => {
    expect(parse(["  [ ES ]Hola"])).toMatchObject({ language: "es-MX", text: "Hola" });
    expect(parse(["\n[En]", " Hi"])).toMatchObject({ language: "en-US", text: " Hi" });
  });

  it("speaks a reply with no tag and reports it", () => {
    const result = parse(["Hello, how ", "can I help?"]);
    expect(result.language).toBeUndefined();
    expect(result.text).toBe("Hello, how can I help?");
    expect(result.missing).toMatch(/No language tag/);
  });

  it("reports a short reply with no tag once the stream ends", () => {
    expect(parse(["Okay."])).toMatchObject({
      text: "Okay.",
      missing: expect.stringMatching(/No language tag/),
    });
  });

  it("strips a tag the agent does not list", () => {
    expect(parse(["[fr] Bonjour"])).toMatchObject({
      language: undefined,
      text: " Bonjour",
      missing: "Unknown language tag [fr]",
    });
  });

  it("does not treat a later bracket as a tag", () => {
    expect(parse(["Press [1] now please"])).toMatchObject({
      language: undefined,
      text: "Press [1] now please",
    });
  });

  it("supports any number of languages", () => {
    const many = { en: "en-GB", fr: "fr-FR", de: "de-DE", pt: "pt-BR", ja: "ja-JP" };
    expect(parse(["[fr] Bonjour"], many).language).toBe("fr-FR");
    expect(parse(["[ja]", "こんにちは"], many)).toMatchObject({
      language: "ja-JP",
      text: "こんにちは",
    });
    expect(parse(["[es] Hola"], { en: "en-US" })).toMatchObject({
      missing: "Unknown language tag [es]",
    });
  });

  it("supports a single-language agent", () => {
    expect(parse(["[en] Hi"], { en: "en-US" })).toMatchObject({ language: "en-US", text: " Hi" });
  });
});
