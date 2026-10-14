import type { SetupQuestion } from "@/lib/store/workspace-model";

/**
 * The interview may name the community system it built on by id ("built on our canteen-pos system"). Owners know
 * those systems by name, so ids are swapped for names before a reply is shown.
 */
export function withSystemNames(text: string, systems: { id: string; name: string }[]): string {
  let out = text;
  for (const s of systems) {
    const id = s.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${id}\\b`, "gi"), s.name);
  }
  return out;
}

/** A reply that announces questions ("I have 3 quick questions:") but stops before asking them. */
export function questionsMissing(message: string): boolean {
  return /:\s*$/.test(message.trim()) && !/\?/.test(message);
}

const keyOf = (q: { id: string }) => q.id.trim().toLowerCase();

/**
 * This turn's checklist on top of the last one. Gemini rewrites the list every turn and now and then drops a
 * question or forgets an answer it already had: a question it left out comes back, an answer it blanked keeps the
 * owner's earlier one, and a question once required stays required until it's answered.
 */
export function mergeQuestions(previous: SetupQuestion[], next: SetupQuestion[]): SetupQuestion[] {
  const before = new Map(previous.map((q) => [keyOf(q), q]));
  const seen = new Set<string>();
  const merged: SetupQuestion[] = [];
  for (const q of next) {
    const key = keyOf(q);
    if (!key || seen.has(key) || !q.question.trim()) continue;
    seen.add(key);
    const old = before.get(key);
    merged.push({
      id: q.id.trim(),
      question: q.question.trim(),
      required: q.required || (!!old?.required && !old.answer.trim()),
      answer: q.answer.trim() || old?.answer.trim() || "",
    });
  }
  // Kept in their old place among the rest would reorder the list the owner sees; they go at the end instead.
  for (const q of previous) if (!seen.has(keyOf(q))) merged.push(q);
  return merged.slice(0, 24);
}

/** Required questions the owner hasn't answered yet. */
export function openRequired(questions: SetupQuestion[]): SetupQuestion[] {
  return questions.filter((q) => q.required && !q.answer.trim());
}

/** A reply that asks the open required questions again, for when Gemini wanted to design without them. */
export function askAgainMessage(open: SetupQuestion[]): string {
  const list = open
    .slice(0, 4)
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join("\n");
  return `Almost there. I still need ${open.length === 1 ? "one answer" : "a few answers"} before I build it, so the workspace uses your real details:\n\n${list}`;
}
