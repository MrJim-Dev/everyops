import "server-only";
import type { Finding } from "@/lib/assistant/checkup";
import { memoryContext, type WorkspaceMemory } from "@/lib/assistant/memory";
import { fieldUsage } from "@/lib/assistant/related";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { todayKey } from "@/lib/time";
import { pageExcerpts } from "./assistant";
import { CHECKUP_SYSTEM, checkupAnswer, toFindings } from "./checkup-prompt";
import { dataDigest } from "./digest";
import { generateJsonHedged } from "./gemini";

/** Compares the workspace with its memory and returns what to fix. Throws when Gemini can't answer. */
export async function runCheckup(input: {
  blueprint: Blueprint;
  records: DataRecord[];
  docs?: Record<string, { body: string }>;
  memory: WorkspaceMemory;
  summary: string;
}): Promise<Finding[]> {
  const bp = input.blueprint;
  const prompt = `Today in Manila: ${todayKey()}

About this business (the workspace's memory):
${memoryContext(input.memory, input.summary) || "Nothing saved yet; use the workspace itself."}

Blueprint:
${JSON.stringify(bp)}

Where each field is used:
${fieldUsage(bp) || "(nothing yet)"}

Pages with written text:
${pageExcerpts(bp, input.docs) || "(none)"}

Data digest:
${dataDigest(bp, input.records, { ids: [] })}`;
  const result = await generateJsonHedged(
    checkupAnswer,
    {
      system: CHECKUP_SYSTEM,
      prompt,
      task: "assistant-checkup",
      thinking: "LOW",
      timeoutMs: 45_000,
      maxOutputTokens: 2500,
      maxStringChars: 800,
    },
    { hedgeMs: 25_000, attempts: 2 },
  );
  if (!result.ok) throw new Error(result.error);
  return toFindings(result.data);
}
