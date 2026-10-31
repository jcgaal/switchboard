import { useEffect, useRef } from "react";
import type { CallState } from "@/lib/transcript";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Access = "ok" | "unauthorized" | "closed";

export function Transcript({
  calls,
  active,
  onSelect,
  connected,
  access,
  hasNumbers,
  languages,
}: {
  calls: CallState[];
  active: CallState | null;
  onSelect: (callSid: string) => void;
  connected: boolean;
  access: Access;
  hasNumbers: boolean;
  languages: string[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [active]);

  return (
    <section className="dark-panel" aria-labelledby="transcript-title">
      <div className="dark-panel-heading flex items-center justify-between gap-3 px-5 sm:px-7">
        <h2 id="transcript-title" className="text-[17px] font-semibold tracking-tight text-white">
          Live transcript
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          {calls.length > 1 && (
            <>
              <label className="sr-only" htmlFor="select-call">
                Select call
              </label>
              <select
                id="select-call"
                data-testid="select-call"
                value={active?.callSid ?? ""}
                onChange={(event) => onSelect(event.target.value)}
                className="max-w-[11rem] truncate rounded-full border border-[#2c2c2e] bg-[#1c1c1e] px-3 py-1.5 font-mono text-[11px] text-[#d1d1d6]"
              >
                {calls.map((call, index) => (
                  <option key={call.callSid} value={call.callSid}>
                    Call {index + 1} · {call.from ?? call.callSid.slice(0, 12)}
                    {call.ended ? " · ended" : " · live"}
                  </option>
                ))}
              </select>
            </>
          )}
          {active && (
            <span
              data-testid="status-call"
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 font-mono text-[11px] font-semibold tracking-wider",
                active.ended ? "border border-[#2c2c2e] text-[#8e8e93]" : "bg-white text-black",
              )}
            >
              {active.ended ? `ended · ${active.ended.reason}` : "live"}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
        {!active ? (
          <Waiting connected={connected} access={access} hasNumbers={hasNumbers} />
        ) : (
          <ol className="flex min-h-full flex-col justify-end gap-6" aria-live="polite">
            {active.turns.map((turn) => (
              <li
                key={turn.id}
                data-testid={`turn-${turn.role}-${turn.id}`}
                className={cn(
                  "flex max-w-[88%] flex-col gap-1.5 sm:max-w-[80%]",
                  turn.role === "caller" ? "ml-auto items-end" : "mr-auto items-start",
                )}
              >
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-[#8e8e93]">
                  <span className="rounded-full border border-[#38383a] px-2 py-0.5 text-[9px] uppercase tracking-widest">
                    {turn.role === "caller" ? "caller" : turn.interrupted ? "interrupted" : "agent"}
                  </span>
                  <time>{formatClock(turn.at)}</time>
                </div>
                <div
                  className={cn(
                    "rounded-2xl border p-4 text-[15px] leading-relaxed",
                    turn.role === "caller"
                      ? "rounded-tr-sm border-[#2c2c2e] bg-[#1c1c1e] text-[#f5f5f7]"
                      : "rounded-tl-sm border-[#2c2c2e] bg-transparent text-[#e5e5ea]",
                    turn.interrupted && "border-dashed border-[#8e8e93]/60",
                  )}
                >
                  {turn.normalized ?? turn.text}
                  {turn.role === "caller" &&
                    turn.normalized !== undefined &&
                    turn.normalized !== turn.text && (
                      <p className="mt-2 text-xs leading-relaxed text-[#8e8e93]">
                        heard: {turn.text}
                      </p>
                    )}
                  {!turn.done && (
                    <span
                      aria-label="Agent is speaking"
                      className="ml-1 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-[#d1d1d6]"
                    />
                  )}
                </div>
              </li>
            ))}
            {active.turns.length === 0 && (
              <li className="pb-4 text-center text-sm text-[#8e8e93]">
                Call connected. Waiting for the first words.
              </li>
            )}
          </ol>
        )}
      </div>
      <div className="dark-panel-footer flex items-center justify-between gap-3 px-5 sm:px-7">
        <div className="flex min-w-0 items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-[#8e8e93]">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              active && !active.ended ? "live-dot bg-[#32d74b]" : "bg-[#616166]",
            )}
          />
          <span className="truncate">
            {active ? (active.ended ? "call ended" : "live call") : "no active call"}
          </span>
        </div>
        <span
          data-testid="text-call-voices"
          className="shrink-0 font-mono text-[11px] text-[#8e8e93]"
        >
          {active?.voices && Object.keys(active.voices.voices).length
            ? Object.values(active.voices.voices)
                .map((voice) => voice.split(":").pop())
                .join(" · ")
            : languages.join(" · ")}
        </span>
      </div>
    </section>
  );
}

// Before the first call arrives, the transcript explains how to
// place one, or why the page may not watch any calls, and it
// promises live updates only after the stream has opened.
function Waiting({
  connected,
  access,
  hasNumbers,
}: {
  connected: boolean;
  access: Access;
  hasNumbers: boolean;
}) {
  const [title, text] =
    access === "closed"
      ? [
          "Observers are off",
          "This server does not share calls. Set OBSERVER_TOKEN, or OBSERVER_PUBLIC=true for a public demo.",
        ]
      : access === "unauthorized"
        ? [
            "Access refused",
            "Open this page once with ?token= and the observer token to watch calls.",
          ]
        : [
            "Waiting for a real call",
            connected
              ? `Call ${hasNumbers ? "a number above" : "the agent's number"} and the conversation will appear here.`
              : "Connecting to the live event stream.",
          ];
  return (
    <div
      data-testid="status-waiting"
      className="flex min-h-full flex-col items-center justify-center px-5 text-center"
    >
      <h3 className="text-base font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#8e8e93]">{text}</p>
    </div>
  );
}
