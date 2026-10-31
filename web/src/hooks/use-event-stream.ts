import { useEffect, useRef, useState } from "react";

import type { VoiceEvent } from "@shared/events";
import { observerLogin } from "@/lib/api";

export type { VoiceEvent };

export type SocketState = "connecting" | "open" | "reconnecting";

export const MAX_RAW = 500;

export function useEventStream(onEvent: (e: VoiceEvent) => void) {
  const [state, setState] = useState<SocketState>("connecting");
  const [attempt, setAttempt] = useState(0);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let disposed = false;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${base}/events`;

    const connect = () => {
      if (disposed) return;
      setState(tries === 0 ? "connecting" : "reconnecting");
      ws = new WebSocket(url);
      ws.onopen = () => {
        tries = 0;
        setAttempt(0);
        setState("open");
      };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(String(m.data)) as VoiceEvent;
          if (e && typeof e.type === "string") cb.current({ ...e, payload: e.payload ?? {} });
        } catch {
          // Frames that are not valid JSON are dropped silently, so
          // one malformed message can never bring down the event
          // stream, or crash the dashboard which consumes it.
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        tries += 1;
        setAttempt(tries);
        setState("reconnecting");
        timer = setTimeout(connect, Math.min(1000 * 2 ** (tries - 1), 10000));
      };
      ws.onerror = () => ws?.close();
    };
    void observerLogin().then(connect);
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { state, attempt };
}
