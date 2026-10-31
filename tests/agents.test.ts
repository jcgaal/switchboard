import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentError, loadAgent } from "../src/agents/load";

const agentsDir = path.resolve(import.meta.dirname, "../agents");
const badDir = path.resolve(import.meta.dirname, "fixtures/agents");
const folders = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

describe("example agents", () => {
  it("ships intake, reminder and echo", () => {
    expect(folders(agentsDir).sort()).toEqual(["echo", "intake", "reminder"]);
  });

  for (const name of folders(agentsDir)) {
    it(`${name} validates`, () => {
      const agent = loadAgent(path.join(agentsDir, name));
      expect(agent.name).toBe(name);
      expect(agent.languages[agent.default_language]).toBeDefined();
      if (agent.responder === "model") expect(agent.prompt.length).toBeGreaterThan(0);
    });
  }

  it("intake keeps the menu digits and both languages", () => {
    const agent = loadAgent(path.join(agentsDir, "intake"));
    expect(Object.keys(agent.languages).sort()).toEqual(["en-US", "es-MX"]);
    expect(agent.language_menu?.options).toEqual({ "1": "es-MX", "2": "en-US" });
    expect(agent.transcription.hints).toContain("Salesforce");
  });
});

describe("invalid agents", () => {
  const failure = (name: string) => {
    try {
      loadAgent(path.join(badDir, name));
    } catch (error) {
      expect(error).toBeInstanceOf(AgentError);
      return (error as Error).message;
    }
    throw new Error(`${name} loaded without errors`);
  };

  it("names a missing field", () => {
    expect(failure("missing-greeting")).toContain("languages.en-US.greeting");
  });

  it("names every reference to an undefined language", () => {
    const message = failure("unknown-language");
    expect(message).toContain("default_language: Unknown language fr-FR");
    expect(message).toContain("language_menu.options.3: Unknown language de-DE");
  });

  it("requires a prompt for a model agent", () => {
    expect(failure("model-without-prompt")).toContain("prompt: A model agent needs a prompt file");
  });

  it("reports a missing agent folder", () => {
    expect(failure("does-not-exist")).toContain("agent.yaml");
  });
});
