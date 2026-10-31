import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config";

export const OBSERVER_COOKIE = "switchboard_observer";

type Access =
  | { status: "open" }
  | { status: "granted"; cookie?: string }
  | { status: "unauthorized" }
  | { status: "closed" };

const digest = (value: string) => createHash("sha256").update(value).digest();
const matches = (given: string | undefined, expected: Buffer) =>
  Boolean(given) && timingSafeEqual(digest(given!), expected);

function cookie(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

const secure = (request: IncomingMessage) =>
  (request.socket as { encrypted?: boolean }).encrypted ||
  request.headers["x-forwarded-proto"] === "https";

// The cookie holds a hash of the token, never the token itself,
// and JavaScript cannot read it, so a dashboard script or an
// extension loaded on the page can never lift that token.
export function observerAccess(request: IncomingMessage): Access {
  const token = env.OBSERVER_TOKEN;
  if (!token) return env.OBSERVER_PUBLIC === "true" ? { status: "open" } : { status: "closed" };
  const expected = digest(token);
  const session = digest(token).toString("hex");
  if (matches(cookie(request, OBSERVER_COOKIE), digest(session))) return { status: "granted" };
  const header = request.headers.authorization ?? "";
  if (header.startsWith("Bearer ") && matches(header.slice(7), expected))
    return { status: "granted" };
  const query =
    new URL(request.url ?? "/", "http://localhost").searchParams.get("token") ?? undefined;
  if (matches(query, expected)) {
    const flags = [
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=2592000",
      ...(secure(request) ? ["Secure"] : []),
    ];
    return { status: "granted", cookie: `${OBSERVER_COOKIE}=${session}; ${flags.join("; ")}` };
  }
  return { status: "unauthorized" };
}

export const refusal = {
  closed: "Observers are off. Set OBSERVER_TOKEN, or OBSERVER_PUBLIC=true for a public demo.",
  unauthorized:
    "Missing or invalid observer token. Open the dashboard once with ?token=<OBSERVER_TOKEN>.",
};

// A token in the address bar is swapped for the cookie, and a
// page load is then redirected to the same URL without it,
// so it never stays in history, logs, or a shared link.
export function requireObserver(request: Request, response: Response, next: NextFunction) {
  const access = observerAccess(request);
  if (access.status === "closed" || access.status === "unauthorized") {
    response
      .status(access.status === "closed" ? 403 : 401)
      .type("text/plain")
      .send(refusal[access.status]);
    return;
  }
  if (access.status === "granted" && access.cookie) {
    response.append("Set-Cookie", access.cookie);
    if (request.method === "GET" && request.accepts("html") && !request.path.startsWith("/api/")) {
      const url = new URL(request.originalUrl, "http://localhost");
      url.searchParams.delete("token");
      response.redirect(302, url.pathname + url.search);
      return;
    }
  }
  next();
}
