import { z } from "zod";
import { MEMORY_KINDS, type MemoryEdit, type WorkspaceMemory } from "@/lib/assistant/memory";

export const MEMORY_SYSTEM = `You keep the memory of one business's EveryOps workspace: short notes the workspace assistant
reads before every conversation so it knows the business and what the team is building toward.

From the person's latest message (the earlier turns are context), return the notes to add, update or remove.
Save only what will still matter in later conversations, stated by the person or clearly confirmed by them:
- business: what the business is and how it runs: what it sells or offers, prices and rates, opening hours,
  branches and locations, team and roles, customers, suppliers, policies, payment methods, peak times, its size.
- preference: how they want the workspace or the assistant to work: naming, formats, what to show first, what to
  always or never do ("always ask before deleting", "call them members, not customers").
- goal: what they're working toward or planning next: "we're opening a second branch in December", "want to start
  selling online", "preparing for the BIR audit".
Don't save questions, one-off requests ("add a phone field"), what a change plan builds (the workspace already shows
it), individual records, today's numbers, your own guesses or anything the notes already say.
Each note is one short sentence that stands on its own ("Opening hours: 6 AM to 10 PM daily", "Plans a second
branch in Mandaue by December"). When the message changes something a note says, update that note (its id) instead
of adding another; remove a note the person says is no longer true. Most messages need nothing: return an empty list.`;

export const memoryAnswer = z.object({
  notes: z.array(
    z.object({
      action: z.enum(["add", "update", "remove"]),
      id: z.string().describe('The note id, e.g. "mem_ab12cd34", for update and remove; "" for add'),
      kind: z.enum(MEMORY_KINDS),
      text: z.string().describe('The note, one short sentence; "" for remove'),
    }),
  ),
});
export type MemoryAnswer = z.infer<typeof memoryAnswer>;

/** Words that suggest the message says something lasting about the business or how the team wants things. */
const CUES =
  /\b(we|we're|we've|our|ours|us|i|i'm|i've|my|mine|always|never|prefer|from now on|remember|forget|no longer|anymore|usually|every (day|week|month)|open|close|branch|price|rate|charge|staff|team|customers?|plan(ning)?|goal|want)\b/i;

/** Whether a message is worth a memory call: questions and commands without any of these words skip it. */
export function worthRemembering(text: string, attachments = 0) {
  const t = text.trim();
  if (t.length < 15) return attachments > 0 && t.length > 0;
  return CUES.test(t);
}

export function memoryPrompt(input: {
  memory: WorkspaceMemory;
  workspaceName: string;
  pages: string[];
  messages: { role: "user" | "assistant"; text: string }[];
}) {
  const notes = input.memory.notes.length
    ? input.memory.notes.map((n) => `- [${n.id}] (${n.kind}) ${n.text}`).join("\n")
    : "- none yet";
  return `Workspace: ${input.workspaceName}
Its pages: ${input.pages.join(", ") || "none"}

Notes so far:
${notes}

Conversation (latest last; only the person's last message can add notes):
${input.messages
  .slice(-6)
  .map((m) => `${m.role === "user" ? "Person" : "Assistant"}: ${m.text.slice(0, 1500)}`)
  .join("\n\n")}`;
}

/** Gemini's answer as edits: ids must be real notes, at most five changes a message. */
export function toEdits(answer: MemoryAnswer, memory: WorkspaceMemory): MemoryEdit[] {
  const ids = new Set(memory.notes.map((n) => n.id));
  const edits: MemoryEdit[] = [];
  for (const n of answer.notes) {
    if (n.action === "remove") {
      if (ids.has(n.id)) edits.push({ action: "remove", id: n.id });
    } else if (!n.text.trim()) continue;
    else if (n.action === "update" && ids.has(n.id))
      edits.push({ action: "update", id: n.id, text: n.text, kind: n.kind });
    else edits.push({ action: "add", kind: n.kind, text: n.text });
  }
  return edits.slice(0, 5);
}
