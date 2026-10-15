import "server-only";
import type { MemoryEdit, WorkspaceMemory } from "@/lib/assistant/memory";
import { generateJsonHedged } from "./gemini";
import { MEMORY_SYSTEM, memoryAnswer, memoryPrompt, toEdits, worthRemembering } from "./memory-prompt";

/**
 * What the latest message adds to the workspace's memory. Runs beside the assistant's own call, with a small schema,
 * so it costs no waiting; any failure just means nothing is remembered this time.
 */
export async function noteMemory(input: {
  memory: WorkspaceMemory;
  workspaceName: string;
  pages: string[];
  messages: { role: "user" | "assistant"; text: string; attachments?: unknown[] }[];
  signal?: AbortSignal;
}): Promise<MemoryEdit[]> {
  const last = input.messages.at(-1);
  if (last?.role !== "user" || !worthRemembering(last.text, last.attachments?.length ?? 0)) return [];
  // It answers in 2–3 s from a small prompt, so a call silent for 5 s has stalled: a twin costs next to nothing and
  // keeps the note from missing the answer it rides along with.
  const result = await generateJsonHedged(
    memoryAnswer,
    {
      system: MEMORY_SYSTEM,
      prompt: memoryPrompt(input),
      task: "assistant-memory",
      thinking: "LOW",
      timeoutMs: 20_000,
      maxOutputTokens: 1200,
      maxStringChars: 600,
      signal: input.signal,
    },
    { hedgeMs: 5_000, afterSilence: true, attempts: 2 },
  );
  if (!result.ok) {
    console.warn(JSON.stringify({ event: "assistant_memory_failed", message: result.error }));
    return [];
  }
  return toEdits(result.data, input.memory);
}
