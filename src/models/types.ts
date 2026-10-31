export type Turn = { role: "user" | "assistant"; content: string };
export type Usage = { inputTokens: number; outputTokens: number };

export type StreamRequest = {
  system: string;
  messages: Turn[];
  maxTokens: number;
  signal: AbortSignal;
};

export type CompleteRequest = {
  system: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
};

// Usage is optional because some local servers never report it.
// Each usage chunk replaces the prior one, so the last chunk
// a stream yields carries the totals for the whole reply.
export interface ModelAdapter {
  readonly id: string;
  stream(request: StreamRequest): AsyncIterable<{ text?: string; usage?: Usage }>;
  complete(request: CompleteRequest): Promise<{ text: string; usage?: Usage }>;
}

export class ModelError extends Error {
  constructor(
    readonly status: number | null,
    readonly type: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export type Fetch = typeof fetch;
