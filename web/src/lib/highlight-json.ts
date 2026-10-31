export type JsonToken = { text: string; kind?: "key" | "string" | "number" | "literal" };

const TOKEN =
  /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?/g;

// Highlighting runs one regular expression per line to find keys,
// strings, numbers and literals, which is all it takes for the
// indented JSON that every one of the event blocks renders.
export function highlightJson(line: string): JsonToken[] {
  const pieces: JsonToken[] = [];
  let cursor = 0;
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) pieces.push({ text: line.slice(cursor, index) });
    const text = match[0];
    const isKey =
      text.startsWith('"') &&
      line
        .slice(index + text.length)
        .trimStart()
        .startsWith(":");
    const kind = isKey
      ? "key"
      : text.startsWith('"')
        ? "string"
        : /^-?\d/.test(text)
          ? "number"
          : "literal";
    pieces.push({ text, kind });
    cursor = index + text.length;
  }
  if (cursor < line.length) pieces.push({ text: line.slice(cursor) });
  return pieces;
}
