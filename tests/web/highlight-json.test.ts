import { describe, expect, it } from "vitest";
import { highlightJson } from "../../web/src/lib/highlight-json";

describe("highlightJson", () => {
  it("marks keys, strings, numbers and literals in one line", () => {
    expect(highlightJson('  "last": true, "n": -1.5, "token": "a \\"b\\"", "x": null')).toEqual([
      { text: "  " },
      { text: '"last"', kind: "key" },
      { text: ": " },
      { text: "true", kind: "literal" },
      { text: ", " },
      { text: '"n"', kind: "key" },
      { text: ": " },
      { text: "-1.5", kind: "number" },
      { text: ", " },
      { text: '"token"', kind: "key" },
      { text: ": " },
      { text: '"a \\"b\\""', kind: "string" },
      { text: ", " },
      { text: '"x"', kind: "key" },
      { text: ": " },
      { text: "null", kind: "literal" },
    ]);
  });

  it("keeps plain punctuation as unmarked text", () => {
    expect(highlightJson("  },")).toEqual([{ text: "  }," }]);
  });
});
