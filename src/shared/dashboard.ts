import { z } from "zod";

export const PublicNumber = z.object({
  label: z.string().min(1),
  number: z.string().min(1),
});

// Everything the dashboard shows about the agent and the line
// comes from the server, so the page has no names, numbers
// or languages of its own, only a layout to frame them.
export const DashboardConfig = z.object({
  agent: z.object({
    name: z.string(),
    displayName: z.string(),
    headline: z.string(),
    subline: z.string(),
  }),
  languages: z.array(z.object({ locale: z.string(), label: z.string() })),
  menuHints: z.array(z.string()),
  numbers: z.array(PublicNumber.extend({ href: z.string() })),
  repoUrl: z.string(),
  forkUrl: z.string(),
  model: z.string(),
});

export type PublicNumber = z.infer<typeof PublicNumber>;
export type DashboardConfig = z.infer<typeof DashboardConfig>;
