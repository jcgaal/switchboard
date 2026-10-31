import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VoiceSettings } from "@shared/voices";
import { EventStream, type Raw } from "@/components/EventStream";
import { Hero } from "@/components/Hero";
import { Topbar } from "@/components/Topbar";
import { Transcript, type Access } from "@/components/Transcript";
import { setSettings } from "@/components/VoicePicker";
import { useEventStream, MAX_RAW, type VoiceEvent } from "@/hooks/use-event-stream";
import { useDashboardConfig } from "@/lib/api";
import { callSeconds, formatDuration } from "@/lib/format";
import { applyEvent, type CallState } from "@/lib/transcript";
import { VOICE_TIMING, VoiceActivity, type Speaker } from "@/lib/voice-activity";

let rawSeq = 0;

// The page keeps every call seen since it opened, follows the
// newest call automatically, and feeds each event into the
// transcript, the raw event stream, and the voice wave.
export default function Monitor() {
  const [raw, setRaw] = useState<Raw[]>([]);
  const [calls, setCalls] = useState<Record<string, CallState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  const voice = useRef(new VoiceActivity()).current;
  const queryClient = useQueryClient();
  const { data: config, error } = useDashboardConfig();
  const access: Access =
    error?.status === 401 ? "unauthorized" : error?.status === 403 ? "closed" : "ok";

  useEffect(() => {
    if (config) document.title = `${config.agent.displayName} · voice agent monitor`;
  }, [config]);

  // Each event fans out to the wave, the raw stream and per-call state,
  // and a voice change from another dashboard goes straight into the
  // query cache, which keeps this picker in step with the others.
  const onEvent = useCallback(
    (event: VoiceEvent) => {
      voice.note(event);
      setRaw((previous) => {
        const next = [...previous, { ...event, _k: ++rawSeq }];
        return next.length > MAX_RAW ? next.slice(next.length - MAX_RAW) : next;
      });
      setCalls((previous) => applyEvent(previous, event, ""));
      if (event.type === "call.started" && event.callSid) setSelected(event.callSid);
      if (event.type === "voice.settings")
        setSettings(queryClient, event.payload as unknown as VoiceSettings);
    },
    [voice, queryClient],
  );
  const { state, attempt } = useEventStream(onEvent);
  const callList = useMemo(
    () => Object.values(calls).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [calls],
  );
  const active = (selected && calls[selected]) || callList[callList.length - 1] || null;
  const activeSid = active?.callSid ?? null;
  const activeEnded = Boolean(active?.ended);
  const getSpeaker = useCallback(() => voice.speaker(activeSid), [voice, activeSid]);

  useEffect(() => {
    if (!activeSid || activeEnded) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeSid, activeEnded]);

  // The speaker label polls the voice tracker a few times a
  // second, because speech deadlines expire on their own
  // with no new event arriving to trigger a rerender.
  useEffect(() => {
    const interval = window.setInterval(() => setSpeaker(getSpeaker()), VOICE_TIMING.pollMs);
    return () => window.clearInterval(interval);
  }, [getSpeaker]);

  const clear = () => {
    setRaw([]);
    setCalls({});
    setSelected(null);
    voice.clear();
  };

  return (
    <div className="monitor-env">
      <div className="monitor-dashboard">
        <Topbar config={config} state={state} attempt={attempt} />
        <Hero
          config={config}
          getSpeaker={getSpeaker}
          speaker={speaker}
          live={!!active && !active.ended}
          duration={active ? formatDuration(callSeconds(active, now)) : "00:00"}
        />
        <main className="monitor-panels">
          <Transcript
            calls={callList}
            active={active}
            onSelect={setSelected}
            connected={state === "open"}
            access={access}
            hasNumbers={Boolean(config?.numbers.length)}
            languages={config?.languages.map((language) => language.label) ?? []}
          />
          <EventStream
            events={raw}
            follow={follow}
            onFollow={() => setFollow((value) => !value)}
            onClear={clear}
            connected={state === "open"}
            call={active}
            now={now}
            model={config?.model ?? "model"}
          />
        </main>
      </div>
    </div>
  );
}
