import "server-only";
import { memoryContext, type WorkspaceMemory } from "@/lib/assistant/memory";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { pageExcerpts } from "./assistant";
import { dataDigest } from "./digest";
import { generateJsonHedged } from "./gemini";
import { MEMORY_DRAFT_SYSTEM, memoryDraftAnswer, toDraftNotes } from "./memory-draft-prompt";

/** Notes drafted from the workspace (design, records, pages) for the owner to confirm in Settings → Assistant. */
export async function draftMemory(input: {
  blueprint: Blueprint;
  records: DataRecord[];
  docs?: Record<string, { body: string }>;
  memory: WorkspaceMemory;
  name: string;
  summary: string;
}) {
  const bp = input.blueprint;
  const prompt = `Workspace: ${input.name}
Summary: ${input.summary || "(none)"}

Notes it already has:
${memoryContext(input.memory) || "(none)"}

Blueprint:
${JSON.stringify(bp)}

Pages with written text:
${pageExcerpts(bp, input.docs) || "(none)"}

Data digest:
${dataDigest(bp, input.records, { ids: [] })}`;
  const result = await generateJsonHedged(
    memoryDraftAnswer,
    {
      system: MEMORY_DRAFT_SYSTEM,
      prompt,
      task: "assistant-memory-draft",
      thinking: "LOW",
      timeoutMs: 45_000,
      maxOutputTokens: 2000,
      maxStringChars: 600,
    },
    { hedgeMs: 25_000, attempts: 2 },
  );
  if (!result.ok) throw new Error(result.error);
  return toDraftNotes(result.data, input.memory);
}
