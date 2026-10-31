import type { DashboardConfig } from "@shared/dashboard";
import { VoicePicker } from "@/components/VoicePicker";
import { VoiceWave } from "@/components/VoiceWave";
import type { Speaker } from "@/lib/voice-activity";
import { cn } from "@/lib/utils";

export function Hero({
  config,
  getSpeaker,
  speaker,
  live,
  duration,
}: {
  config: DashboardConfig | undefined;
  getSpeaker: () => Speaker | null;
  speaker: Speaker | null;
  live: boolean;
  duration: string;
}) {
  return (
    <section className="monitor-hero" aria-labelledby="hero-title">
      <div className="monitor-wave">
        <VoiceWave getSpeaker={getSpeaker} />
      </div>
      <div className="monitor-hero-header">
        <h2 id="hero-title" className="monitor-hero-title">
          {config?.agent.headline}
          <span>{config?.agent.subline}</span>
        </h2>
        <VoicePicker />
      </div>
      <div className="monitor-hero-overlay">
        <div className="monitor-timer" data-testid="text-call-duration">
          {duration}
        </div>
        <div className="monitor-hero-status">
          <SpeakerChip speaker={speaker} live={live} />
          <div className="monitor-legend" aria-hidden="true">
            <span>
              <i className="swatch swatch-caller" />
              caller
            </span>
            <span>
              <i className="swatch swatch-agent" />
              agent
            </span>
          </div>
        </div>
        <div className="monitor-hero-meta" data-testid="text-menu-hints">
          {config?.menuHints.map((hint) => (
            <span key={hint}>{hint}</span>
          ))}
          <span className="monitor-hero-note">
            Wave shows call activity from events, not audio.
          </span>
        </div>
      </div>
    </section>
  );
}

// The chip names the current speaker in the same swatch colors
// as the wave, and falls back to listening during a call or
// to waiting whenever there is no live call in progress.
function SpeakerChip({ speaker, live }: { speaker: Speaker | null; live: boolean }) {
  const label =
    speaker === "caller"
      ? "Caller speaking"
      : speaker === "agent"
        ? "Agent speaking"
        : live
          ? "Listening"
          : "Waiting for a call";
  return (
    <div className="monitor-glass-pill" data-testid="status-speaker" aria-live="polite">
      <i className={cn("swatch", speaker ? `swatch-${speaker}` : "swatch-idle")} />
      {label}
    </div>
  );
}
