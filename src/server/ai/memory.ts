import "server-only";
import type { MemoryEdit, WorkspaceMemory } from "@/lib/assistant/memory";
import { generateJson } from "./gemini";
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
  const result = await generateJson(memoryAnswer, {
    system: MEMORY_SYSTEM,
    prompt: memoryPrompt(input),
    task: "assistant-memory",
    thinking: "LOW",
    timeoutMs: 20_000,
    maxOutputTokens: 1200,
    maxStringChars: 600,
    signal: input.signal,
  });
  if (!result.ok) {
    console.warn(JSON.stringify({ event: "assistant_memory_failed", message: result.error }));
    return [];
  }
  return toEdits(result.data, input.memory);
}
