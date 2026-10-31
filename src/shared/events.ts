import { z } from "zod";

// Every event the server records has this envelope. The payload
// stays an open record since each event type carries its own
// fields, and the dashboard reads them carefully by name.
export const VoiceEvent = z.object({
  timestamp: z.string(),
  callSid: z.string().nullable(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export type VoiceEvent = z.infer<typeof VoiceEvent>;
