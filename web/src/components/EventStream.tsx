import type React from "react";
import { memo, useEffect, useRef } from "react";
import { ArrowDownToLine, Eraser } from "lucide-react";
import { MAX_RAW, type VoiceEvent } from "@/hooks/use-event-stream";
import { UsageMeter } from "@/components/UsageMeter";
import { formatStamp } from "@/lib/format";
import { highlightJson, type JsonToken } from "@/lib/highlight-json";
import type { CallState } from "@/lib/transcript";
import { cn } from "@/lib/utils";

export type Raw = VoiceEvent & { _k: number };

export function EventStream({
  events,
  follow,
  onFollow,
  onClear,
  connected,
  call,
  now,
  model,
}: {
  events: Raw[];
  follow: boolean;
  onFollow: () => void;
  onClear: () => void;
  connected: boolean;
  call: CallState | null;
  now: number;
  model: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events, follow]);

  return (
    <section className="dark-panel" aria-labelledby="trace-title">
      <div className="flex shrink-0 items-stretch justify-between border-b border-[#2c2c2e] bg-[#1c1c1e]">
        <h2
          id="trace-title"
          className="border-r border-t-2 border-[#2c2c2e] border-t-white bg-[#161618] px-6 py-4 font-mono text-xs font-normal tracking-wide text-white"
        >
          twilio ⇄ model
        </h2>
        <div className="flex items-center gap-1.5 px-4">
          <DarkBtn testid="button-toggle-autoscroll" active={follow} onClick={onFollow}>
            <ArrowDownToLine className="h-3 w-3" /> <span className="hidden sm:inline">Follow</span>
          </DarkBtn>
          <DarkBtn testid="button-clear" onClick={onClear}>
            <Eraser className="h-3 w-3" /> <span className="hidden sm:inline">Clear</span>
          </DarkBtn>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-5">
        {events.length === 0 ? (
          <EmptyEvents connected={connected} />
        ) : (
          <div
            data-testid="code-events"
            className="code-lines min-w-max font-mono text-[12px] leading-[1.7]"
          >
            {events.map((event) => (
              <EventBlock key={event._k} event={event} />
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#2c2c2e] bg-[#1c1c1e]/50 px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-[#8e8e93]">
        <UsageMeter call={call} now={now} model={model} />
        <span className="shrink-0">
          {events.length}/{MAX_RAW} events
        </span>
      </div>
    </section>
  );
}

// Each event type is labeled with the direction it travelled, so the
// stream reads as an exchange between Twilio, this API server and
// the model rather than a flat log of raw JSON event payloads.
const DIRECTION: Record<string, string> = {
  "webhook.received": "Twilio → app",
  "twiml.returned": "app → Twilio",
  "twilio.inbound": "Twilio → app",
  "twilio.outbound": "app → Twilio",
  "model.request.start": "app → model",
  "model.stream.end": "model → app",
  "error.model": "model → app",
  "transcript.normalized": "model → app",
  "transcript.normalize_failed": "model → app",
};

const TOKEN_COLOR: Record<NonNullable<JsonToken["kind"]>, string> = {
  key: "text-[#81a1c1]",
  string: "text-[#a3be8c]",
  number: "text-[#ebcb8b]",
  literal: "text-[#d08770]",
};

// Each event is rendered once and memoized, since a busy call sends
// hundreds of tokens and line numbers are made by a CSS counter,
// so older blocks never re-render as newer ones are arriving.
const EventBlock = memo(function EventBlock({ event }: { event: Raw }) {
  const kind = typeof event.payload.type === "string" ? ` · ${event.payload.type}` : "";
  const header = `// ${formatStamp(event.timestamp)} · ${DIRECTION[event.type] ?? "app"} · ${event.type}${kind}`;
  const lines = JSON.stringify(
    { callSid: event.callSid, type: event.type, payload: event.payload },
    null,
    2,
  ).split("\n");
  return (
    <div className="pb-3">
      <div className="code-line">
        <code className="whitespace-pre pr-8 text-[#616e88]">{header}</code>
      </div>
      {lines.map((line, index) => (
        <div key={index} className="code-line">
          <code className="whitespace-pre pr-8 text-[#c9c9ce]">
            {highlightJson(line).map((token, position) =>
              token.kind ? (
                <span key={position} className={TOKEN_COLOR[token.kind]}>
                  {token.text}
                </span>
              ) : (
                token.text
              ),
            )}
          </code>
        </div>
      ))}
    </div>
  );
});

// The empty stream renders as a single line of code, noting that
// events show up only while the page is open, unless a replay
// buffer is on, which hands a newcomer the recent history.
function EmptyEvents({ connected }: { connected: boolean }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center font-mono">
      <div className="text-[12px] text-[#c9c9ce]">
        <span className="text-[#d08770]">let</span> stream ={" "}
        <span className="text-[#a3be8c]">"{connected ? "listening" : "connecting"}"</span>;
      </div>
      <p className="mt-3 max-w-sm text-[11px] leading-relaxed text-[#8e8e93]">
        Events appear while this page is open.
      </p>
    </div>
  );
}

// Small dark buttons for the code panel toolbar. A brighter
// border marks the active state so the follow toggle can
// be read as on or off with no need for a text label.
function DarkBtn({
  children,
  onClick,
  active,
  testid,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#81a1c1]",
        active
          ? "border-[#8e8e93] text-white"
          : "border-[#38383a] text-[#8e8e93] hover:text-[#f5f5f7]",
      )}
    >
      {children}
    </button>
  );
}
