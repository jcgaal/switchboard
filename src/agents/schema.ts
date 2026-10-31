import { z } from "zod";

const Locale = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Expected a locale such as en-US");

export const AgentLanguage = z.object({
  tag: z.string().regex(/^[a-z]{2,3}$/, "Expected a short tag such as en"),
  greeting: z.string().min(1),
  closing_time_limit: z.string().min(1),
  error_apology: z.string().min(1),
  default_voice: z
    .string()
    .regex(/^[A-Za-z]+:.+$/, "Expected provider:id, such as Amazon:Joanna-Neural"),
});

const MenuPrompt = z.object({ language: Locale, text: z.string().min(1) });

export const AgentFile = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/, "Expected lowercase letters, digits and dashes"),
    display_name: z.string().min(1),
    description: z.string().min(1),
    responder: z.enum(["model", "echo"]).default("model"),
    default_language: Locale,
    time_limit_seconds: z.number().int().positive(),
    max_reply_tokens: z.number().int().positive().default(300),
    languages: z
      .record(Locale, AgentLanguage)
      .refine((languages) => Object.keys(languages).length > 0, {
        message: "At least one language is required",
      }),
    language_menu: z
      .object({
        enabled: z.boolean(),
        timeout_seconds: z.number().int().positive().default(3),
        options: z.record(z.string().regex(/^[0-9]$/, "Expected a single keypad digit"), Locale),
        prompts: z.record(Locale, z.array(MenuPrompt).min(1)),
      })
      .optional(),
    transcription: z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      language: z.string().min(1).default("multi"),
      hints: z.array(z.string().min(1)).default([]),
    }),
    pronunciation: z.record(z.string().min(1), z.string().min(1)).default({}),
    dashboard: z.object({
      headline: z.string().min(1),
      subline: z.string().min(1),
    }),
    prompt: z.string().min(1).optional(),
  })
  .superRefine((agent, context) => {
    const known = new Set(Object.keys(agent.languages));
    const check = (language: string, path: (string | number)[]) => {
      if (!known.has(language)) {
        context.addIssue({
          code: "custom",
          path,
          message: `Unknown language ${language}, not listed under languages`,
        });
      }
    };
    check(agent.default_language, ["default_language"]);
    for (const [digit, language] of Object.entries(agent.language_menu?.options ?? {})) {
      check(language, ["language_menu", "options", digit]);
    }
    for (const [key, prompts] of Object.entries(agent.language_menu?.prompts ?? {})) {
      check(key, ["language_menu", "prompts", key]);
      prompts.forEach((prompt, index) =>
        check(prompt.language, ["language_menu", "prompts", key, index, "language"]),
      );
    }
    if (agent.responder === "model" && !agent.prompt) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "A model agent needs a prompt file",
      });
    }
  });

export type AgentFile = z.infer<typeof AgentFile>;
export type AgentLanguage = z.infer<typeof AgentLanguage>;

// The loaded agent holds its prompt text rather than the
// file name, and nothing after the loader touches the
// agent folder, or needs to know where it is kept.
export type Agent = Omit<AgentFile, "prompt"> & { prompt: string };
