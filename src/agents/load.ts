import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { env } from "../config";
import { AgentFile, type Agent, type AgentLanguage } from "./schema";

export class AgentError extends Error {}

// Every problem is reported with its field path, so anyone
// writing an agent file can fix it, without reading the
// schema code, and a broken agent stops this server.
export function loadAgent(directory: string): Agent {
  const file = path.join(directory, "agent.yaml");
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new AgentError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = AgentFile.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new AgentError(`${file} is invalid:\n${issues.join("\n")}`);
  }
  let prompt = "";
  if (result.data.prompt) {
    try {
      prompt = readFileSync(path.join(directory, result.data.prompt), "utf8").trim();
    } catch {
      throw new AgentError(`${file} is invalid:\n  prompt: Cannot read ${result.data.prompt}`);
    }
  }
  return { ...result.data, prompt };
}

let current: Agent | undefined;

export function agent(): Agent {
  current ??= loadAgent(path.resolve(env.AGENTS_DIR || "./agents", env.AGENT || "echo"));
  return current;
}

export function agentLanguage(language: string): AgentLanguage {
  const { languages, default_language } = agent();
  return languages[language] ?? languages[default_language];
}

// Numbers are compared on digits alone, so a mapping may be
// written with spaces or dashes, and Twilio always sends
// the number which was dialed, in compact E.164 form.
const digits = (number: string) => number.replace(/\D/g, "");

// NUMBER_LANGUAGES maps a dialed number to the language its
// callers hear first. It is checked against the agent on
// load, so a typo fails at startup and not on a call.
export function parseNumberLanguages(raw: string | undefined, loaded: Agent): Map<string, string> {
  if (!raw?.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentError(`NUMBER_LANGUAGES is not valid JSON. Expected {"+15550100":"en-US"}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentError(`NUMBER_LANGUAGES must be an object such as {"+15550100":"en-US"}`);
  }
  const map = new Map<string, string>();
  for (const [number, language] of Object.entries(parsed)) {
    if (typeof language !== "string" || !loaded.languages[language]) {
      throw new AgentError(
        `NUMBER_LANGUAGES: ${number} maps to ${String(language)}, which agent ${loaded.name} does not list`,
      );
    }
    if (!digits(number)) throw new AgentError(`NUMBER_LANGUAGES: ${number} is not a phone number`);
    map.set(digits(number), language);
  }
  return map;
}

let numbers: Map<string, string> | undefined;

export function numberLanguages(): Map<string, string> {
  numbers ??= parseNumberLanguages(env.NUMBER_LANGUAGES, agent());
  return numbers;
}

export function languageForNumber(number: unknown): string {
  const mapped = typeof number === "string" ? numberLanguages().get(digits(number)) : undefined;
  return mapped ?? agent().default_language;
}
