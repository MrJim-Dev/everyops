import "server-only";
import type { Blueprint } from "@/lib/blueprint/types";
import { splitToolName } from "@/lib/connections";
import type { OutsideTools } from "../connections";
import { generateJsonHedged } from "./gemini";
import {
  describeTypes,
  LOOKUP_SYSTEM,
  lookupAnswer,
  lookupAnswerWithActions,
  needsLookup,
  OUTSIDE_WORDS,
  outsideSystem,
  requiresLookupEvidence,
} from "./lookup-prompt";
import { type LookupCall, type LookupResult, lookupResult } from "./lookup-result";
import { recordTools } from "./record-tools";

/**
 * Looks up the data a message needs before the assistant answers: Gemini calls aggregate, search_records and
 * get_record (SQL over the workspace's records) with a small answer schema. The assistant's own schema sits at
 * Gemini's structural limit, so tools can't go there. Returns explicit retrieval status and complete results; failures are never confused with skipped lookups.
 */
export async function lookupData(input: {
  workspaceId: string;
  blueprint: Blueprint;
  digest: string;
  screen: string;
  today: string;
  messages: { role: "user" | "assistant"; text: string }[];
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
  /** Connected outside MCP servers' read tools (owners and admins only). */
  outside?: OutsideTools | null;
}): Promise<LookupResult & { proposals?: { tool: string; arguments: string; summary: string }[] }> {
  // Greetings, navigation and design changes need no records: skip the round instead of asking Gemini.
  const last = input.messages.filter((m) => m.role === "user").at(-1)?.text ?? "";
  const outside = input.outside;
  if (!needsLookup(last) && !(outside && OUTSIDE_WORDS.test(last))) {
    console.info(JSON.stringify({ event: "lookup_skipped" }));
    return lookupResult(input.blueprint, [], true);
  }
  const records = recordTools(input.workspaceId, input.blueprint, input.onStatus);
  const tools = outside
    ? {
        ...records,
        declarations: [...records.declarations, ...outside.declarations],
        run: (name: string, args: Record<string, unknown>) => {
          const split = splitToolName(name);
          if (!split) return records.run(name, args);
          input.onStatus?.(split.provider === "gmail" ? "Checking Gmail" : "Checking Google Calendar");
          return outside.run(name, args);
        },
      }
    : records;
  const prompt = `Today in Manila: ${input.today}

Record types (field ids, option ids, links):
${describeTypes(input.blueprint)}

What the person is looking at:
${input.screen}

Data digest:
${input.digest}

Conversation (latest last):
${input.messages
  .slice(-6)
  .map((m) => `${m.role === "user" ? "Person" : "Assistant"}: ${m.text.slice(0, 1500)}`)
  .join("\n\n")}`;
  let previous: LookupCall[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const log: LookupCall[] = [];
    const run = async (name: string, args: Record<string, unknown>) => {
      const result = await tools.run(name, args);
      log.push({ name, args, result });
      return result;
    };
    const result = await generateJsonHedged(
      outside ? lookupAnswerWithActions : lookupAnswer,
      {
        system: outside
          ? LOOKUP_SYSTEM + outsideSystem(outside.providers, outside.proposable, outside.notes)
          : LOOKUP_SYSTEM,
        prompt:
          prompt +
          (attempt
            ? `\nThe previous lookup was incomplete or failed. Perform a fresh, complete set of calls for this request using the supplied field and option ids. Do not infer scoped totals from the digest. Previous attempt:\n${JSON.stringify(previous)}`
            : ""),
        task: "assistant-lookup",
        signal: input.signal,
        thinking: "LOW",
        timeoutMs: 30_000,
        maxOutputTokens: 1500,
        tools: { ...tools, run, maxRounds: 3 },
      },
      // Lookups take 2 to 9 s; a call with nothing back after 10 s has stalled (the global endpoint does that now and
      // then), so its twin starts then instead of after 20.
      { hedgeMs: 10_000, afterSilence: true, attempts: 2 },
    );
    // Outside writes the lookup proposed: saved for approval by the caller, never run here. A request for an outside
    // change ("add a calendar event Saturday 8 AM") is complete with its proposal even though it read nothing.
    const proposals =
      result.ok && "actions" in result.data && Array.isArray(result.data.actions) ? result.data.actions : [];
    const complete = result.ok && (!requiresLookupEvidence(last) || log.length > 0 || proposals.length > 0);
    const checked = lookupResult(input.blueprint, log, complete);
    console.info(
      JSON.stringify({
        event: "lookup_result",
        attempt,
        status: checked.status,
        calls: log.length,
        proposals: proposals.length,
      }),
    );
    if (checked.status !== "failed" || attempt === 1 || input.signal?.aborted)
      return proposals.length ? { ...checked, proposals } : checked;
    previous = log;
  }
  return lookupResult(input.blueprint, [], false);
}
