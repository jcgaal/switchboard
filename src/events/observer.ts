import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { addObserver, observers } from "./bus";

export const observerSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });

export function upgradeObserver(request: IncomingMessage, socket: Duplex, head: Buffer) {
  // Browsers always send an Origin header, so a browser observer
  // must come from this host. Clients sending no Origin, such
  // as server scripts, are let through without this check.
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
  }
  observerSockets.handleUpgrade(request, socket, head, (ws) => {
    observerSockets.emit("connection", ws, request);
    addObserver(ws);
    // Observers are read-only. Anything a client sends is
    // dropped unread, so a dashboard watches calls but
    // never steers one or reaches into the session.
    ws.on("message", () => {});
    ws.on("close", () => observers.delete(ws));
    ws.on("error", () => {
      observers.delete(ws);
      ws.terminate();
    });
  });
}
