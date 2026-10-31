import { useMutation, useQuery, type UseMutationOptions } from "@tanstack/react-query";
import type { DashboardConfig } from "@shared/dashboard";
import type { VoiceSettings, VoiceSettingsState } from "@shared/voices";

export const voiceSettingsKey = ["/api/voice-settings"] as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  await observerLogin();
  const response = await fetch(url, init);
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}

export function useDashboardConfig() {
  return useQuery<DashboardConfig, ApiError>({
    queryKey: ["/api/dashboard"],
    queryFn: () => request<DashboardConfig>("/api/dashboard"),
    retry: (count, error) => error.status !== 401 && error.status !== 403 && count < 3,
  });
}

export function useVoiceSettings() {
  return useQuery({
    queryKey: voiceSettingsKey,
    queryFn: () => request<VoiceSettingsState>("/api/voice-settings"),
  });
}

// A control token arrives once as ?control= in the dashboard URL.
// It is kept for this tab alone, then removed from the address
// bar, so it stays out of history and out of a shared link.
const CONTROL_KEY = "switchboard.control";

export function controlToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("control");
    if (fromUrl) {
      sessionStorage.setItem(CONTROL_KEY, fromUrl);
      url.searchParams.delete("control");
      window.history.replaceState(null, "", url);
    }
    return sessionStorage.getItem(CONTROL_KEY);
  } catch {
    return null;
  }
}

export function useUpdateVoiceSettings(
  options?: UseMutationOptions<VoiceSettingsState, ApiError, VoiceSettings>,
) {
  return useMutation({
    mutationKey: ["updateVoiceSettings"],
    mutationFn: (settings: VoiceSettings) =>
      request<VoiceSettingsState>("/api/voice-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(controlToken() ? { Authorization: `Bearer ${controlToken()}` } : {}),
        },
        body: JSON.stringify(settings),
      }),
    ...options,
  });
}

let login: Promise<void> | undefined;

// The server swaps ?token= for an HttpOnly cookie when it serves
// the page. Under the Vite dev server this call does the same
// through the dev proxy, before the event stream connects.
export function observerLogin(): Promise<void> {
  login ??= swapToken();
  return login;
}

async function swapToken(): Promise<void> {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    if (!token) return;
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url);
    await fetch(`/api/status?token=${encodeURIComponent(token)}`, { credentials: "same-origin" });
  } catch {
    // A failed swap leaves every request refused, and then the
    // dashboard shows that access is refused, so a user can
    // reload this page with a valid ?token= in the link.
  }
}
