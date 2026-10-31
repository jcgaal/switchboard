import { Router, type IRouter } from "express";
import { z } from "zod";
import { agent, languageForNumber } from "../agents/load";
import type { Agent } from "../agents/schema";
import { env, skipSignature } from "../config";
import { requireObserver } from "../events/access";
import { missingModelSettings, model } from "../models/registry";
import { DashboardConfig, PublicNumber } from "../shared/dashboard";

const HealthStatus = z.object({ status: z.string() });

const Status = z.object({
  ready: z.boolean(),
  agent: z.string(),
  missingSecrets: z.array(z.string()),
  model: z.string(),
  defaultLanguage: z.string(),
  callLimitSeconds: z.number().int(),
  signatureValidation: z.boolean(),
});

export const DEFAULT_REPO_URL = "https://github.com/jcgaal/switchboard";

// PUBLIC_NUMBERS lists the lines shown on the dashboard. It is
// parsed at startup, so a broken value stops the deployment
// instead of quietly hiding all the numbers on the page.
export function parsePublicNumbers(raw: string | undefined): PublicNumber[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'PUBLIC_NUMBERS is not valid JSON. Expected [{"label":"United States","number":"+15550100"}]',
    );
  }
  const result = PublicNumber.array().safeParse(parsed);
  if (!result.success) {
    throw new Error(
      'PUBLIC_NUMBERS must be a list such as [{"label":"United States","number":"+15550100"}]',
    );
  }
  return result.data;
}

let numbers: PublicNumber[] | undefined;

export function publicNumbers(): PublicNumber[] {
  numbers ??= parsePublicNumbers(env.PUBLIC_NUMBERS);
  return numbers;
}

// Each language is named in its own tongue, the way a caller
// sees it on a menu, so English stays English and Spanish
// shows up as Español, with no table kept in the code.
export function languageLabel(locale: string): string {
  try {
    const name =
      new Intl.DisplayNames([locale], { type: "language" }).of(locale.split("-")[0]) ?? locale;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return locale;
  }
}

// Each hint names a line, the language it answers in, and the
// menu prompts offering the other languages, which is what
// a caller hears on that line, before the agent speaks.
export function menuHints(
  loaded: Agent,
  lines: PublicNumber[],
  languageFor: (number: string) => string,
): string[] {
  const menu = loaded.language_menu;
  if (!menu?.enabled) return [];
  const groups = lines.length
    ? lines.map((line) => ({ label: line.label, language: languageFor(line.number) }))
    : [{ label: "", language: loaded.default_language }];
  return groups.map(({ label, language }) => {
    const prompts = (menu.prompts[language] ?? menu.prompts[loaded.default_language] ?? [])
      .filter((prompt) => prompt.language !== language)
      .map((prompt) => prompt.text);
    const intro = `${label ? `${label} line: ` : ""}${languageLabel(language)}.`;
    return [intro, ...prompts].join(" ");
  });
}

const router: IRouter = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.get("/api/healthz", (_req, res) => {
  res.json(HealthStatus.parse({ status: "ok" }));
});

router.get("/api/status", requireObserver, (_req, res) => {
  const twilio = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] as const;
  const modelSettings = agent().responder === "model" ? missingModelSettings() : [];
  const missingSecrets = [...modelSettings, ...twilio.filter((key) => !env[key])];
  res.json(
    Status.parse({
      ready: missingSecrets.length === 0,
      agent: agent().name,
      missingSecrets,
      model: model().id,
      defaultLanguage: agent().default_language,
      callLimitSeconds: agent().time_limit_seconds,
      signatureValidation: !skipSignature(),
    }),
  );
});

// The dashboard copy, lines and languages all come from here.
// It sits behind the observer token like the event stream,
// as it describes the agent that the stream is showing.
router.get("/api/dashboard", requireObserver, (_req, res) => {
  const loaded = agent();
  const repoUrl = (env.REPO_URL || DEFAULT_REPO_URL).replace(/\/+$/, "");
  const lines = publicNumbers();
  res.json(
    DashboardConfig.parse({
      agent: {
        name: loaded.name,
        displayName: loaded.display_name,
        headline: loaded.dashboard.headline,
        subline: loaded.dashboard.subline,
      },
      languages: Object.keys(loaded.languages).map((locale) => ({
        locale,
        label: languageLabel(locale),
      })),
      menuHints: menuHints(loaded, lines, languageForNumber),
      numbers: lines.map((line) => ({
        ...line,
        href: `tel:${line.number.replace(/[^\d+]/g, "")}`,
      })),
      repoUrl,
      forkUrl: /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repoUrl) ? `${repoUrl}/fork` : repoUrl,
      model: loaded.responder === "echo" ? "echo" : model().id,
    }),
  );
});

export default router;
