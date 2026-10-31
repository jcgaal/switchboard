import { useState } from "react";
import { GitFork } from "lucide-react";
import type { DashboardConfig } from "@shared/dashboard";
import type { SocketState } from "@/hooks/use-event-stream";
import { cn } from "@/lib/utils";

export function Topbar({
  config,
  state,
  attempt,
}: {
  config: DashboardConfig | undefined;
  state: SocketState;
  attempt: number;
}) {
  return (
    <header className="monitor-topbar">
      <h1 className="monitor-wordmark">
        {config?.agent.displayName ?? "switchboard"}
        <span>voice agent monitor</span>
      </h1>
      <div className="monitor-topbar-controls">
        {config?.numbers.map((line, index) => (
          <NumberReveal
            key={line.number}
            label={line.label}
            number={line.number}
            href={line.href}
            index={index}
          />
        ))}
        <SocketStatus state={state} attempt={attempt} />
        {config && (
          <a
            href={config.forkUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-fork-repo"
            className="monitor-cta"
          >
            <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            Fork the repo
          </a>
        )}
      </div>
    </header>
  );
}

// Public numbers stay hidden behind a pill until someone asks for
// them, and only then turn into a clickable telephone link, so
// they are never the first thing that visitors notice here.
function NumberReveal({
  label,
  number,
  href,
  index,
}: {
  label: string;
  number: string;
  href: string;
  index: number;
}) {
  const [revealed, setRevealed] = useState(false);

  return revealed ? (
    <a href={href} className="monitor-pill monitor-pill-revealed">
      {label}
      <strong>{number}</strong>
    </a>
  ) : (
    <button
      type="button"
      data-testid={`button-show-number-${index}`}
      aria-expanded={revealed}
      onClick={() => setRevealed(true)}
      className="monitor-pill"
    >
      {label}
      <strong>Display number</strong>
    </button>
  );
}

// The socket pill turns amber while connecting and red while it
// retries, and counts every attempt, so a dead connection to
// the event server is obvious to anyone viewing the page.
function SocketStatus({ state, attempt }: { state: SocketState; attempt: number }) {
  const color =
    state === "open" ? "bg-[#32d74b]" : state === "connecting" ? "bg-[#ebcb8b]" : "bg-[#ea4335]";
  const label =
    state === "open" ? "live" : state === "connecting" ? "connecting" : `retry ${attempt || ""}`;
  return (
    <span data-testid="status-socket" className="monitor-pill monitor-pill-static">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      {label}
    </span>
  );
}
