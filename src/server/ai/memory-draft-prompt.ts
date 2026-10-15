import { z } from "zod";
import { MEMORY_KINDS, type MemoryEdit, type WorkspaceMemory } from "@/lib/assistant/memory";

export const MEMORY_DRAFT_SYSTEM = `You draft the memory of a small business's EveryOps workspace from the workspace itself, for the
owner to confirm. The memory is short notes the assistant reads before every conversation.

Write only what the workspace clearly shows, as facts about the business:
- business: what it offers and sells (with prices or rates from the records), its resources (courts, rooms, tables,
  branches), opening hours from booking settings, payment methods, team roles, kinds of customers, policies its
  pages state, how busy it is (from the digest).
- preference: how the workspace is set up to work that the assistant should keep (what people are called, statuses
  a booking goes through, what must be filled in).
- goal: only plans a page states ("opening a second branch").
Each note is one short sentence that stands on its own ("Courts: Court 1 to Court 4, ₱400 per hour"). Up to 12
notes, most useful first. Never guess, never add a note the existing notes already say, never mention ids,
record counts that will change, or individual customers.`;

export const memoryDraftAnswer = z.object({
  notes: z.array(z.object({ kind: z.enum(MEMORY_KINDS), text: z.string() })),
});

/** Draft notes as edits the owner can accept, skipping empty ones and ones the memory already has. */
export function toDraftNotes(answer: z.infer<typeof memoryDraftAnswer>, memory: WorkspaceMemory) {
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9₱]/g, "");
  const known = new Set(memory.notes.map((n) => key(n.text)));
  const out: Extract<MemoryEdit, { action: "add" }>[] = [];
  for (const n of answer.notes) {
    const text = n.text.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text || known.has(key(text))) continue;
    known.add(key(text));
    out.push({ action: "add", kind: n.kind, text });
  }
  return out.slice(0, 12);
}
