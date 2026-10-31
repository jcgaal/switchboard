import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VoiceEvent } from "../src/shared/events";

const lines = readFileSync(new URL("./fixtures/call-events.ndjson", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean);

describe("recorded call fixture", () => {
  it("matches the shared event envelope", () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(VoiceEvent.safeParse(JSON.parse(line)).success).toBe(true);
    }
  });

  it("ends every talk cycle with an empty last text frame", () => {
    const events = lines.map((line) => VoiceEvent.parse(JSON.parse(line)));
    const ends = events.filter((event) => event.type === "model.stream.end").length;
    const lasts = events.filter(
      (event) =>
        event.type === "twilio.outbound" &&
        event.payload.last === true &&
        event.payload.token === "",
    ).length;
    expect(lasts).toBe(ends);
  });
});
