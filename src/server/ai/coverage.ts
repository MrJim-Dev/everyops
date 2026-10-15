import "server-only";
import type { Blueprint } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import {
  COVERAGE_SYSTEM,
  changedReferences,
  checkedCoverage,
  coverageAnswer,
  coverageEvidence,
} from "./coverage-prompt";
import { generateJsonHedged } from "./gemini";

/** Small independent schema: does not add to the planner's already large output schema. */
export async function reviewCoverage(input: {
  blueprint: Blueprint;
  plan: ChangePlan;
  conversation: string;
  lookup: string;
  today: string;
  signal?: AbortSignal;
  mode?: "setup" | "change";
}) {
  const refs = coverageEvidence(input.blueprint, input.plan);
  const result = await generateJsonHedged(
    coverageAnswer,
    {
      task: "assistant-coverage",
      system:
        COVERAGE_SYSTEM +
        (input.mode === "setup"
          ? "\nThis is a NEW workspace. Check the supplied generated blueprint against the explicit brief. Blueprint evidence is the proposed design, not an existing system. Check only requirements explicit in the brief, not optional industry practices. A supported configuration is sufficient; do not demand that sample records prove every workflow."
          : ""),
      prompt: `Today in Manila: ${input.today}\nConversation (latest request last):\n${input.conversation}\n\nRecord lookup evidence:\n${input.lookup}\n\nRequest to fulfill:\n${input.plan.request}\n\nEvidence map (operations are proposed, other objects are the current workspace):\n${JSON.stringify(refs)}`,
      thinking: "LOW",
      timeoutMs: 30_000,
      maxOutputTokens: 2500,
      maxStringChars: 1000,
      signal: input.signal,
    },
    { hedgeMs: 12_000, afterSilence: true, attempts: 2 },
  );
  if (!result.ok) return null;
  const checked = checkedCoverage(result.data, refs, changedReferences(input.blueprint, input.plan));
  console.info(
    JSON.stringify({
      event: "request_coverage",
      version: "quality-v1",
      mode: input.mode ?? "change",
      model: result.model,
      ms: result.ms,
      tokens: result.tokens,
      covered: checked.covered.length,
      missing: checked.errors.length,
      clarify: checked.questions.length,
    }),
  );
  return checked;
}
