import "server-only";
import type { Blueprint } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import {
  COVERAGE_SYSTEM,
  changedReferences,
  checkedCoverage,
  coverageAnswer,
  coverageEvidence,
  trimCoverage,
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
  /**
   * Setup: the planned sample records, in the evidence map as sample:<ref> so the reviewer can cite the court,
   * product or payment method a requirement is met by. Pasted as text they were cited anyway, and failed.
   */
  samples?: { ref: string; entityId: string; values: { fieldId: string; value: string }[] }[];
}) {
  const refs: Record<string, unknown> = {
    ...coverageEvidence(input.blueprint, input.plan),
    ...Object.fromEntries(
      (input.samples ?? []).map((s) => [
        `sample:${s.ref}`,
        { entity: s.entityId, ...Object.fromEntries(s.values.map((v) => [v.fieldId, v.value])) },
      ]),
    ),
  };
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
      repair: trimCoverage,
      signal: input.signal,
    },
    { hedgeMs: 12_000, afterSilence: true, attempts: 2 },
  );
  if (!result.ok) return null;
  const checked = checkedCoverage(
    result.data,
    refs,
    changedReferences(input.blueprint, input.plan),
    input.mode === "setup",
  );
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
