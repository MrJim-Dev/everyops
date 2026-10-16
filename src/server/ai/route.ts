import type { Part } from "@google/genai";

/**
 * Which model provider answers a task. A test router for comparing models: Gemini stays the default, and Claude
 * (Haiku unless set otherwise) can take every task or chosen ones, to compare answers, speed, failures and cost in
 * Settings → AI use. Read on every call, so changing the environment switches it back without a code change.
 *
 *   AI_PROVIDER=claude                                    every task (default: gemini)
 *   AI_PROVIDER_TASKS=assistant*=claude,design*=gemini    per task; a trailing * matches a prefix; wins over AI_PROVIDER
 *   CLAUDE_MODEL=claude-haiku-4-5@20251001                the Claude model (Vertex ids keep their @version)
 *   CLAUDE_DESIGN_MODEL=claude-sonnet-4-5@20250929        for setup's design tasks (default: CLAUDE_MODEL)
 *   CLAUDE_LOCATION=global                                the Vertex endpoint
 *   ANTHROPIC_API_KEY=…                                   use Anthropic's API instead of Vertex AI
 */
export type Provider = "gemini" | "claude";

type Env = Record<string, string | undefined>;

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5@20251001";

const matches = (task: string, pattern: string) =>
  pattern.endsWith("*") ? task.startsWith(pattern.slice(0, -1)) : task === pattern;

export function providerFor(task: string, env: Env = process.env): Provider {
  for (const pair of (env.AI_PROVIDER_TASKS ?? "").split(",")) {
    const [pattern, provider] = pair.split("=").map((s) => s?.trim());
    if (pattern && (provider === "gemini" || provider === "claude") && matches(task, pattern))
      return provider;
  }
  return env.AI_PROVIDER === "claude" ? "claude" : "gemini";
}

/** The Claude model for a task: design tasks may use a bigger one. */
export function claudeModelFor(task: string, env: Env = process.env): string {
  const model = env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
  return task.startsWith("design") ? env.CLAUDE_DESIGN_MODEL || model : model;
}

/** Where Claude is called: a Vertex endpoint, or "anthropic" for Anthropic's own API. */
export const claudeLocation = (env: Env = process.env) =>
  env.ANTHROPIC_API_KEY ? "anthropic" : env.CLAUDE_LOCATION || "global";

/** Files Claude reads: photos and PDFs. Audio, video and anything else stay with Gemini. */
const CLAUDE_MEDIA = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

/** Whether Claude can take this prompt; a voice note or a video can't, so that call stays with Gemini. */
export function claudeCanTake(prompt: string | Part[]): boolean {
  if (typeof prompt === "string") return true;
  return prompt.every((p) => {
    const mime = p.inlineData?.mimeType ?? p.fileData?.mimeType;
    return mime === undefined ? true : CLAUDE_MEDIA.test(mime);
  });
}
