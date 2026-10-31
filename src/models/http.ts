import { ModelError } from "./types";

// Providers disagree on where an error lives in the body, so
// this checks the common shapes and falls back on status.
// Only the body is read, never the request or headers.
export async function httpError(response: Response, provider: string): Promise<ModelError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return new ModelError(
    response.status,
    text(error.type) ?? text(error.status) ?? text(error.code),
    text(error.message) ??
      text(record.message) ??
      `${provider} returned HTTP ${response.status} with no error message`,
  );
}

export async function* serverSentEvents(response: Response): AsyncIterable<unknown> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data);
    }
  }
}

export function missingKey(name: string): ModelError {
  return new ModelError(null, "configuration", `Missing ${name}`);
}
