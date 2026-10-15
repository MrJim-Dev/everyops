/**
 * A workspace's memory: what Ask EveryOps knows about the business and how the team wants it to work. The owner's
 * instructions are written in Settings → Assistant; notes come from setup (the business profile the interview
 * gathered), from conversations (facts and preferences people state) and from the owner, who can edit or delete any.
 * Every assistant turn starts from it, so the assistant knows what the business is and what it's building toward.
 */

export const MEMORY_KINDS = ["business", "preference", "goal"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemorySource = "setup" | "assistant" | "owner";

export type MemoryNote = {
  id: string;
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMemory = { instructions: string; notes: MemoryNote[]; updatedAt: string | null };

export const EMPTY_MEMORY: WorkspaceMemory = { instructions: "", notes: [], updatedAt: null };
export const MAX_INSTRUCTIONS = 4000;
export const MAX_NOTE_CHARS = 300;
export const MAX_NOTES = 80;

export const KIND_LABEL: Record<MemoryKind, string> = {
  business: "About the business",
  preference: "How the team works",
  goal: "Goals and plans",
};

/** One change to the notes, from a conversation or the owner. */
export type MemoryEdit =
  | { action: "add"; kind: MemoryKind; text: string }
  | { action: "update"; id: string; text: string; kind?: MemoryKind }
  | { action: "remove"; id: string };

const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);
/** Compared without case, punctuation or spacing, so "Open 6 AM–10 PM." and "open 6am-10pm" are one note. */
const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9₱]/g, "");

export function newNoteId() {
  return `mem_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Applies edits to the notes. Duplicates are skipped, unknown ids ignored, and when the list is full the oldest
 * notes the assistant wrote make room (setup and owner notes are kept). Returns the notes and what changed.
 */
export function applyMemoryEdits(
  notes: MemoryNote[],
  edits: MemoryEdit[],
  source: MemorySource,
  now = new Date().toISOString(),
  makeId = newNoteId,
): { notes: MemoryNote[]; added: MemoryNote[]; updated: MemoryNote[]; removed: MemoryNote[] } {
  let next = [...notes];
  const added: MemoryNote[] = [];
  const updated: MemoryNote[] = [];
  const removed: MemoryNote[] = [];
  for (const edit of edits) {
    if (edit.action === "remove") {
      const gone = next.find((n) => n.id === edit.id);
      if (!gone) continue;
      next = next.filter((n) => n.id !== edit.id);
      removed.push(gone);
      continue;
    }
    const text = clean(edit.text);
    if (!text) continue;
    if (edit.action === "update") {
      const i = next.findIndex((n) => n.id === edit.id);
      if (i < 0) continue;
      if (next.some((n, j) => j !== i && key(n.text) === key(text))) continue;
      const note = { ...next[i], text, kind: edit.kind ?? next[i].kind, updatedAt: now };
      next[i] = note;
      updated.push(note);
      continue;
    }
    if (next.some((n) => key(n.text) === key(text))) continue;
    const note: MemoryNote = { id: makeId(), kind: edit.kind, text, source, createdAt: now, updatedAt: now };
    next.push(note);
    added.push(note);
  }
  while (next.length > MAX_NOTES) {
    const oldest = next.findIndex((n) => n.source === "assistant");
    const at = oldest >= 0 ? oldest : 0;
    removed.push(next[at]);
    next.splice(at, 1);
  }
  return { notes: next, added, updated, removed };
}

type SetupLike = {
  prompt?: string;
  progress?: {
    profile?: { label: string; value: string }[];
    questions?: { question: string; answer: string }[];
  };
};

/**
 * The business profile the setup interview gathered, as notes. Setup is cleared when the workspace is created, so
 * this is the moment to keep what the owner told Ask EveryOps about their business.
 */
export function notesFromSetup(setup: SetupLike | undefined, summary: string): MemoryEdit[] {
  const edits: MemoryEdit[] = [];
  if (summary.trim()) edits.push({ action: "add", kind: "business", text: summary });
  for (const line of setup?.progress?.profile ?? [])
    if (line.label?.trim() && line.value?.trim())
      edits.push({ action: "add", kind: "business", text: `${line.label.trim()}: ${line.value.trim()}` });
  for (const q of setup?.progress?.questions ?? []) {
    const answer = q.answer?.trim();
    if (!answer || /^(skip|skipped|not sure|n\/a)$/i.test(answer)) continue;
    edits.push({
      action: "add",
      kind: "business",
      text: `${q.question.trim().replace(/\?$/, "")}: ${answer}`,
    });
  }
  // The owner's first description, when the interview didn't break it into a profile.
  if (edits.length <= 1 && setup?.prompt?.trim())
    edits.push({ action: "add", kind: "business", text: `In the owner's words: ${setup.prompt.trim()}` });
  return edits;
}

/** The memory as the assistant reads it: the business first, then preferences, goals and the owner's instructions. */
export function memoryContext(memory: WorkspaceMemory, summary = ""): string {
  const parts: string[] = [];
  const byKind = (kind: MemoryKind) => memory.notes.filter((n) => n.kind === kind);
  const line = (n: MemoryNote) => `- ${n.text} [${n.id}]`;
  const business = byKind("business");
  const known = new Set(business.map((n) => key(n.text)));
  const about = [
    ...(summary.trim() && !known.has(key(summary)) ? [`- ${summary.trim()}`] : []),
    ...business.map(line),
  ];
  if (about.length)
    parts.push(`What the business is (from setup and earlier conversations):\n${about.join("\n")}`);
  const prefs = byKind("preference");
  if (prefs.length) parts.push(`How the team wants things done:\n${prefs.map(line).join("\n")}`);
  const goals = byKind("goal");
  if (goals.length) parts.push(`What they're working toward:\n${goals.map(line).join("\n")}`);
  if (memory.instructions.trim())
    parts.push(
      `The owner's standing instructions for you (follow them unless they ask for something EveryOps can't do):\n${memory.instructions.trim()}`,
    );
  return parts.join("\n\n");
}
