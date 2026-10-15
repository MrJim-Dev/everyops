import "server-only";
import type { Blueprint } from "@/lib/blueprint/types";
import { generateJsonHedged } from "./gemini";
import { describeTypes, LOOKUP_SYSTEM, lookupAnswer, needsLookup } from "./lookup-prompt";
import { recordTools } from "./record-tools";

const MAX_RESULT_CHARS = 14_000;

/**
 * Looks up the data a message needs before the assistant answers: Gemini calls aggregate, search_records and
 * get_record (SQL over the workspace's records) with a small answer schema. The assistant's own schema sits at
 * Gemini's structural limit, so tools can't go there. Returns the calls and their results as text, or "" when
 * nothing was needed or the lookup failed (the assistant still has the digest).
 */
export async function lookupData(input: {
  workspaceId: string;
  blueprint: Blueprint;
  digest: string;
  screen: string;
  today: string;
  messages: { role: "user" | "assistant"; text: string }[];
  onStatus?: (text: string) => void;
}): Promise<string> {
  // Greetings, navigation and design changes need no records: skip the round instead of asking Gemini.
  const last = input.messages.filter((m) => m.role === "user").at(-1)?.text ?? "";
  if (!needsLookup(last)) {
    console.info(JSON.stringify({ event: "lookup_skipped" }));
    return "";
  }
  const tools = recordTools(input.workspaceId, input.blueprint, input.onStatus);
  const log: string[] = [];
  const run = async (name: string, args: Record<string, unknown>) => {
    const result = await tools.run(name, args);
    log.push(`- ${name} ${JSON.stringify(args)}\n  → ${JSON.stringify(result)}`);
    return result;
  };
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
  const result = await generateJsonHedged(
    lookupAnswer,
    {
      system: LOOKUP_SYSTEM,
      prompt,
      task: "assistant-lookup",
      thinking: "LOW",
      timeoutMs: 30_000,
      maxOutputTokens: 1500,
      tools: { ...tools, run, maxRounds: 3 },
    },
    // Lookups take 2 to 9 s; a call with nothing back after 10 s has stalled (the global endpoint does that now and
    // then), so its twin starts then instead of after 20.
    { hedgeMs: 10_000, afterSilence: true, attempts: 2 },
  );
  if (!result.ok || !log.length) return "";
  // Hedged twins can both have run tools; the log keeps every call, which is harmless (they're the same lookups).
  const text = [...new Set(log)].join("\n");
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n(more results cut off)` : text;
}
