import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";
import { WebSocketServer } from "ws";
import { observerAccess, refusal, requireObserver } from "./events/access";
import { logger, recordEvent } from "./events/bus";
import { observerSockets, upgradeObserver } from "./events/observer";
import statusRouter from "./routes/status";
import voiceSettingsRouter from "./routes/voice-settings";
import { CallSession } from "./session/call-session";
import { validSignature } from "./twilio/signature";
import twimlRouter from "./twilio/twiml";

export function createServer(options: { publicDir?: string } = {}): Server {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(statusRouter);
  app.use(twimlRouter);
  app.use("/api", voiceSettingsRouter);

  // The built dashboard sits next to the server bundle. Any other
  // GET that is not an API call gets index.html for the client
  // router, while in development Vite serves the UI itself.
  const publicDir =
    options.publicDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "public");
  if (existsSync(publicDir)) {
    app.use((req, res, next) =>
      /^\/(api|voice|health)(\/|$)/.test(req.path) ? next() : requireObserver(req, res, next),
    );
    app.use(express.static(publicDir, { index: false }));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  const server = createHttpServer(app);
  const calls = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on("upgrade", (request, socket, head) => {
    const route = (request.url ?? "").split("?")[0];
    if (route === "/ws") {
      if (!validSignature(request, request.url ?? "/ws", {}, true)) {
        recordEvent(null, "error.signature", {
          path: "/ws",
          reason: "Invalid or missing Twilio signature",
        });
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      calls.handleUpgrade(request, socket, head, (ws) => {
        calls.emit("connection", ws, request);
        new CallSession(ws);
      });
    } else if (route === "/events") {
      const access = observerAccess(request);
      if (access.status === "closed" || access.status === "unauthorized") {
        const status = access.status === "closed" ? "403 Forbidden" : "401 Unauthorized";
        socket.end(
          `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${refusal[access.status]}`,
        );
        return;
      }
      upgradeObserver(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  // A heartbeat keeps idle observers connected and terminates
  // any socket that stops answering, so clients which went
  // away without closing do not pile up on this server.
  const alive = new WeakSet();
  const heartbeat = setInterval(() => {
    for (const ws of [...calls.clients, ...observerSockets.clients]) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);
  for (const wss of [calls, observerSockets]) {
    wss.on("connection", (ws) => {
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
    });
  }
  server.on("close", () => clearInterval(heartbeat));
  return server;
}
