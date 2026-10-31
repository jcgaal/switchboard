import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";
import { loadAgent } from "../src/agents/load";
import { VoiceEvent } from "../src/shared/events";
import { applyEvent, type CallState } from "../web/src/lib/transcript";

const base = (
  process.env.SWITCHBOARD_URL || `http://localhost:${process.env.PORT || 8080}`
).replace(/\/+$/, "");
const token = process.env.OBSERVER_TOKEN ?? "";
const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
const agentsDir = path.resolve(import.meta.dirname, "..", process.env.AGENTS_DIR || "agents");

let calls: Record<string, CallState> = {};
let connected = false;
let lastError = "";

// The tool watches /events like a dashboard and builds calls with
// the same reducer, so it only knows calls since it connected,
// plus the events EVENT_REPLAY keeps on the running server.
function watch() {
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/events`, { headers });
  socket.on("open", () => {
    connected = true;
    lastError = "";
  });
  socket.on("message", (data) => {
    try {
      const event = VoiceEvent.safeParse(JSON.parse(String(data)));
      if (event.success) calls = applyEvent(calls, event.data, "");
    } catch {
      // A frame that is not valid JSON is skipped, and the
      // next one is read as usual, so a single bad line
      // can never stop the tool from tracking calls.
    }
  });
  socket.on("error", (error) => {
    lastError = error.message;
  });
  socket.on("close", () => {
    connected = false;
    setTimeout(watch, 2000);
  });
}

function summary(call: CallState) {
  return {
    callSid: call.callSid,
    from: call.from,
    language: call.language,
    startedAt: call.startedAt,
    lastEventAt: call.lastEventAt,
    live: !call.ended,
    ended: call.ended,
    turns: call.turns.length,
    usage: call.usage,
  };
}

function detail(call: CallState) {
  return {
    ...summary(call),
    voices: call.voices,
    transcript: call.turns.map((turn) => ({
      role: turn.role,
      at: turn.at,
      text: turn.normalized ?? turn.text,
      ...(turn.normalized !== undefined && turn.normalized !== turn.text
        ? { heard: turn.text }
        : {}),
      ...(turn.interrupted ? { interrupted: true } : {}),
      ...(turn.done ? {} : { speaking: true }),
    })),
  };
}

// Without a live stream the answer says so, along with the reason,
// since an empty list from a refused token would otherwise look
// like a quiet line rather than a broken or missing setting.
function stream() {
  if (connected) return { connected, url: `${base}/events` };
  return { connected, url: `${base}/events`, error: lastError || "connecting" };
}

async function activeAgent(): Promise<string | null> {
  try {
    const response = await fetch(`${base}/api/dashboard`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const config = (await response.json()) as { agent?: { name?: string } };
    return config.agent?.name ?? null;
  } catch {
    return null;
  }
}

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const server = new McpServer({ name: "switchboard", version: "0.0.0" });

server.registerTool(
  "list_calls",
  {
    description:
      "List calls seen on the running switchboard server, newest first, with turn counts and usage.",
  },
  async () => {
    const list = Object.values(calls)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(summary);
    return json({ stream: stream(), calls: list });
  },
);

server.registerTool(
  "get_call",
  {
    description: "Get one call's transcript, voices and usage by its Twilio call SID.",
    inputSchema: {
      callSid: z.string().min(1).describe("Twilio call SID, as returned by list_calls"),
    },
  },
  async ({ callSid }) => {
    const call = calls[callSid];
    if (!call)
      return { ...json({ stream: stream(), error: `No call ${callSid} seen yet` }), isError: true };
    return json(detail(call));
  },
);

server.registerTool(
  "list_agents",
  {
    description:
      "List the agent folders in AGENTS_DIR, whether each one validates, and which one the server runs.",
  },
  async () => {
    const active = await activeAgent();
    const folders = existsSync(agentsDir)
      ? readdirSync(agentsDir, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isDirectory() && existsSync(path.join(agentsDir, entry.name, "agent.yaml")),
          )
          .map((entry) => entry.name)
          .sort()
      : [];
    const agents = folders.map((folder) => {
      try {
        const agent = loadAgent(path.join(agentsDir, folder));
        return {
          folder,
          name: agent.name,
          displayName: agent.display_name,
          description: agent.description,
          responder: agent.responder,
          defaultLanguage: agent.default_language,
          languages: Object.keys(agent.languages),
          active: agent.name === active,
        };
      } catch (error) {
        return { folder, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return json({ agentsDir, active, agents });
  },
);

watch();
await server.connect(new StdioServerTransport());
