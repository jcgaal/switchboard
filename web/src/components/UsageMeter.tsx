import type { CallState } from "@/lib/transcript";
import { callSeconds, formatDuration } from "@/lib/format";

// Models are billed in tokens across every request a call makes,
// while Twilio bills ConversationRelay by the minute, so both
// are listed side by side, with all characters fed to TTS.
export function UsageMeter({
  call,
  now,
  model,
}: {
  call: CallState | null;
  now: number;
  model: string;
}) {
  if (!call) return <span className="truncate">No call selected</span>;
  const { usage } = call;
  const seconds = callSeconds(call, now);
  const minutes = Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
  const n = (value: number) => value.toLocaleString();
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="text-call-usage"
    >
      <span title={`${usage.requests} model requests this call`}>
        <b className="font-medium normal-case text-[#d1d1d6]">{model}</b> {n(usage.inputTokens)} in
        · {n(usage.outputTokens)} out
      </span>
      <span title="ConversationRelay is billed per minute; voice minutes are billed separately. Rounded up here.">
        <b className="font-medium text-[#d1d1d6]">twilio</b> {formatDuration(seconds)} · {minutes}{" "}
        relay min · {n(usage.ttsChars)} tts chars
      </span>
    </span>
  );
}
