import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAgent } from "../src/agents/load";
import { languageLabel, menuHints, parsePublicNumbers } from "../src/routes/status";

const agentsDir = path.resolve(import.meta.dirname, "../agents");
const intake = loadAgent(path.join(agentsDir, "intake"));
const reminder = loadAgent(path.join(agentsDir, "reminder"));
const lines = [
  { label: "United States", number: "+15550100" },
  { label: "Mexico", number: "+15550102" },
];

let close = () => {};

async function boot(settings: Record<string, string>) {
  vi.stubEnv("AGENTS_DIR", agentsDir);
  for (const name of [
    "AGENT",
    "OBSERVER_TOKEN",
    "OBSERVER_PUBLIC",
    "PUBLIC_NUMBERS",
    "REPO_URL",
    "NUMBER_LANGUAGES",
  ]) {
    vi.stubEnv(name, settings[name] ?? "");
  }
  vi.resetModules();
  const { createServer } = await import("../src/app");
  const server = createServer();
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (headers: Record<string, string> = {}) => fetch(`${base}/api/dashboard`, { headers });
}

afterEach(() => {
  close();
  vi.unstubAllEnvs();
});

describe("menu hints", () => {
  it("names each line, its language and the other menu options", () => {
    const hints = menuHints(intake, lines, (number) =>
      number === "+15550100" ? "en-US" : "es-MX",
    );
    expect(hints).toEqual([
      "United States line: English. Para español presione 1.",
      "Mexico line: Español. For English press 2.",
    ]);
  });

  it("uses the agent default language when no lines are listed", () => {
    expect(menuHints(intake, [], () => "en-US")).toEqual(["Español. For English press 2."]);
  });

  it("gives no hints for an agent without a menu", () => {
    expect(menuHints(reminder, lines, () => "en-US")).toEqual([]);
  });

  it("names languages in their own tongue", () => {
    expect(languageLabel("en-US")).toBe("English");
    expect(languageLabel("es-MX")).toBe("Español");
    expect(languageLabel("fr-FR")).toBe("Français");
    expect(languageLabel("de-DE")).toBe("Deutsch");
  });
});

describe("public numbers", () => {
  it("parses the list and treats empty as none", () => {
    expect(parsePublicNumbers(JSON.stringify(lines))).toEqual(lines);
    expect(parsePublicNumbers("")).toEqual([]);
    expect(parsePublicNumbers(undefined)).toEqual([]);
  });

  it("fails loudly on a broken value", () => {
    expect(() => parsePublicNumbers("[{")).toThrow(/not valid JSON/);
    expect(() => parsePublicNumbers('[{"label":"US"}]')).toThrow(/must be a list/);
  });
});

describe("GET /api/dashboard", () => {
  it("sits behind the observer token", async () => {
    const get = await boot({ AGENT: "intake", OBSERVER_TOKEN: "observer-secret" });
    expect((await get()).status).toBe(401);
    expect((await get({ authorization: "Bearer observer-secret" })).status).toBe(200);
  });

  it("describes the agent, its lines and the repository", async () => {
    const get = await boot({
      AGENT: "intake",
      OBSERVER_PUBLIC: "true",
      PUBLIC_NUMBERS: JSON.stringify([{ label: "United States", number: "+1 555 0100" }]),
      NUMBER_LANGUAGES: '{"+15550100":"en-US"}',
    });
    const config = await (await get()).json();
    expect(config).toMatchObject({
      agent: {
        name: "intake",
        displayName: "Example Co intake line",
        headline: "Talk to the agent.",
      },
      languages: [
        { locale: "en-US", label: "English" },
        { locale: "es-MX", label: "Español" },
      ],
      menuHints: ["United States line: English. Para español presione 1."],
      numbers: [{ label: "United States", number: "+1 555 0100", href: "tel:+15550100" }],
      repoUrl: "https://github.com/jcgaal/switchboard",
      forkUrl: "https://github.com/jcgaal/switchboard/fork",
    });
  });

  it("hides numbers when none are set and links other hosts as they are", async () => {
    const get = await boot({
      AGENT: "echo",
      OBSERVER_PUBLIC: "true",
      REPO_URL: "https://git.example.com/team/switchboard/",
    });
    const config = await (await get()).json();
    expect(config).toMatchObject({ numbers: [], menuHints: [], model: "echo" });
    expect(config.repoUrl).toBe("https://git.example.com/team/switchboard");
    expect(config.forkUrl).toBe(config.repoUrl);
  });
});
