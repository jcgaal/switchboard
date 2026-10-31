import { useQueryClient } from "@tanstack/react-query";
import {
  counterpart,
  fitsSlot,
  voiceKey,
  type VoiceOption,
  type VoiceSettings,
  type VoiceSettingsState,
} from "@shared/voices";
import {
  controlToken,
  useUpdateVoiceSettings,
  useVoiceSettings,
  voiceSettingsKey,
} from "@/lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Each locale is named in its own language by the browser, so
// a slot reads as English or español without the dashboard
// keeping a table of the languages any agent might use.
function localeLabel(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return locale;
  }
}

// The picker writes to the server, since that is where the next call
// reads its TwiML from. The cache gets updated optimistically, so
// the pills respond right away while the request is in flight.
export function VoicePicker() {
  const queryClient = useQueryClient();
  const { data } = useVoiceSettings();
  const update = useUpdateVoiceSettings({
    onMutate: (settings) => setSettings(queryClient, settings),
    onSuccess: (state) => queryClient.setQueryData(voiceSettingsKey, state),
    onError: () => queryClient.invalidateQueries({ queryKey: voiceSettingsKey }),
  });
  if (!data) return null;
  const { settings, catalog, control } = data;
  const editable = control === "open" || (control === "token" && Boolean(controlToken()));
  const save = (next: VoiceSettings) => editable && update.mutate(next);
  const engines = [...new Set(catalog.map((voice) => voice.engine))];
  const slots = Object.keys(settings.voices);

  const picker = (
    <div
      className={cn("voice-picker", !editable && "is-locked")}
      data-testid="voice-picker"
      tabIndex={editable ? undefined : 0}
    >
      <div className="voice-picker-row">
        <span className="voice-picker-caption">Next call voice</span>
        <div className="engine-toggle" role="radiogroup" aria-label="Voice engine">
          {engines.map((engine) => (
            <button
              key={engine}
              type="button"
              role="radio"
              aria-checked={settings.engine === engine}
              disabled={!editable}
              data-testid={`button-engine-${engine}`}
              className={cn(settings.engine === engine && "is-active")}
              onClick={() => {
                if (settings.engine === engine) return;
                const voices = Object.fromEntries(
                  slots.map((slot) => [
                    slot,
                    counterpart(catalog, settings.voices[slot], engine, slot),
                  ]),
                );
                if (Object.values(voices).every(Boolean))
                  save({ engine, voices: voices as Record<string, string> });
              }}
            >
              {engine}
            </button>
          ))}
        </div>
      </div>
      <div className="voice-picker-row">
        {slots.map((slot) => (
          <VoiceSelect
            key={slot}
            slot={slot}
            value={settings.voices[slot]}
            disabled={!editable}
            voices={catalog.filter(
              (voice) => voice.engine === settings.engine && fitsSlot(voice, slot),
            )}
            onChange={(voice) =>
              save({ ...settings, voices: { ...settings.voices, [slot]: voice } })
            }
          />
        ))}
      </div>
    </div>
  );
  if (editable) return picker;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{picker}</TooltipTrigger>
      <TooltipContent>
        {control === "token"
          ? "Read-only. Open the dashboard once with ?control= and the control token to change voices."
          : "Read-only. Set CONTROL_TOKEN, or PUBLIC_VOICE_PICKER=true, to let viewers change voices."}
      </TooltipContent>
    </Tooltip>
  );
}

// Voices are grouped by accent, so US and British English, or Mexican
// and Castilian Spanish, can be compared side by side. Each option
// shows the gender of its voice exactly as Twilio documents it.
function VoiceSelect({
  slot,
  value,
  disabled,
  voices,
  onChange,
}: {
  slot: string;
  value: string;
  disabled: boolean;
  voices: VoiceOption[];
  onChange: (key: string) => void;
}) {
  const locales = [...new Set(voices.map((v) => v.locale))];
  return (
    <label className="voice-select">
      <span>{localeLabel(slot.split("-")[0])}</span>
      <select
        value={value}
        disabled={disabled}
        data-testid={`select-voice-${slot}`}
        onChange={(event) => onChange(event.target.value)}
      >
        {locales.map((locale) => (
          <optgroup key={locale} label={localeLabel(locale)}>
            {voices
              .filter((voice) => voice.locale === locale)
              .map((voice) => (
                <option key={voiceKey(voice)} value={voiceKey(voice)}>
                  {voice.name} · {voice.gender} · {locale.split("-")[1] ?? locale}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}

// Other dashboards learn of a new choice from the voice.settings event.
// This writes it into the cached query data, so every open dashboard
// shows the voices that the next caller will hear once connected.
export function setSettings(
  queryClient: ReturnType<typeof useQueryClient>,
  settings: VoiceSettings,
) {
  queryClient.setQueryData<VoiceSettingsState>(voiceSettingsKey, (state) =>
    state ? { ...state, settings } : state,
  );
}
