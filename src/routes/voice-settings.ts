import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { agent } from "../agents/load";
import { env } from "../config";
import { recordEvent } from "../events/bus";
import { VoiceSettings, VoiceSettingsState, type VoiceControl } from "../shared/voices";
import {
  catalogFor,
  getVoiceSettings,
  setVoiceSettings,
  VoiceSettingsError,
} from "../voices/settings";

const router: IRouter = Router();

// A set CONTROL_TOKEN always wins. Without one the picker is
// read-only unless PUBLIC_VOICE_PICKER opens it for demos
// where anyone watching may set the next call's voice.
function control(): VoiceControl {
  if (env.CONTROL_TOKEN) return "token";
  return env.PUBLIC_VOICE_PICKER === "true" ? "open" : "locked";
}

// Both sides are hashed first, so the comparison takes the
// same time for any token length, and nothing about the
// stored token leaks through how long requests take.
function hasToken(req: Request): boolean {
  const header = req.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return Boolean(given) && timingSafeEqual(digest(given), digest(env.CONTROL_TOKEN ?? ""));
}

const state = () =>
  VoiceSettingsState.parse({
    settings: getVoiceSettings(),
    catalog: catalogFor(agent()),
    control: control(),
  });

// The dashboard loads the current choice with the catalog,
// so the picker never has a voice list of its own which
// could drift from the voices that the server takes.
router.get("/voice-settings", (_req, res) => {
  res.json(state());
});

// Each accepted change is broadcast to every open dashboard,
// and a rejected one names both the slot and reason, so a
// client never needs to guess which voice was refused.
router.put("/voice-settings", (req, res) => {
  const mode = control();
  if (mode === "locked") {
    res
      .status(403)
      .json({ error: "Voice picker is read-only. Set CONTROL_TOKEN or PUBLIC_VOICE_PICKER=true" });
    return;
  }
  if (mode === "token" && !hasToken(req)) {
    res.status(401).json({ error: "Missing or invalid control token" });
    return;
  }
  const body = VoiceSettings.safeParse(req.body);
  if (!body.success) {
    res.status(422).json({ error: "Expected { engine, voices: { <locale>: <provider:id> } }" });
    return;
  }
  try {
    const settings = setVoiceSettings(body.data);
    recordEvent(null, "voice.settings", settings);
    res.json(state());
  } catch (error) {
    if (!(error instanceof VoiceSettingsError)) throw error;
    res.status(422).json({ error: error.message });
  }
});

export default router;
