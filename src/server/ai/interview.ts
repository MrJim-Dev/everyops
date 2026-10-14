import "server-only";
import { attachmentNames, attachmentsIn } from "@/lib/assistant/attachments";
import type { ChatTurn, SetupQuestion } from "@/lib/store/workspace-model";
import { promptWithFiles } from "./attachments";
import { generateJson } from "./gemini";
import { INTERVIEW_SYSTEM, type Turn, turn } from "./interview-prompt";
import { referencesText, setupReferences } from "./references";
import {
  askAgainMessage,
  mergeQuestions,
  openRequired,
  questionsMissing,
  withSystemNames,
} from "./setup-text";

export type InterviewTurn = Omit<Turn, "questions"> & { questions: SetupQuestion[] };
export type InterviewResult = { ok: true; turn: InterviewTurn } | { ok: false; message: string };

const checklistText = (questions: SetupQuestion[]) =>
  questions.length
    ? `Setup checklist so far (keep every id; fill in answers the owner gave):\n${questions
        .map(
          (q) =>
            `- ${q.id} (${q.required ? "required" : "optional"}): ${q.question} → ${q.answer.trim() || "NOT ANSWERED YET"}`,
        )
        .join("\n")}`
    : "Setup checklist so far: empty. Start it this turn.";

/**
 * One step of the setup conversation: the next reply, or the brief to design from. Files are the owner's own.
 * Required questions on the checklist hold the design back until the owner answers them.
 */
export async function interviewTurn(
  messages: Pick<ChatTurn, "role" | "text" | "attachments">[],
  userId: string,
  previous: SetupQuestion[] = [],
): Promise<InterviewResult> {
  const transcript = messages
    .map((m) => {
      const files = m.attachments?.length ? `\n[Attached: ${attachmentNames(m.attachments)}]` : "";
      return `${m.role === "user" ? "Owner" : "You"}: ${m.text || "(sent files)"}${files}`;
    })
    .join("\n\n");
  // What businesses like this one need and how similar community systems are built, matched on what the owner said.
  const said = messages
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .join("\n");
  const refs = await setupReferences(said);
  const references = referencesText(refs);
  const named = (s: string) => withSystemNames(s, refs.systems);
  const base = await promptWithFiles(
    userId,
    `${references}\n\n${checklistText(previous)}\n\nConversation so far:\n\n${transcript}`,
    attachmentsIn(messages),
    "Write your next turn.",
  );
  let prompt = base;
  let held: { turn: InterviewTurn; open: SetupQuestion[] } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateJson(turn, {
      system: INTERVIEW_SYSTEM,
      prompt,
      task: "interview",
      // A full brief for a business with public pages, add-ons and payments runs 3–8k characters (every status and
      // list type spelled out) and takes 10–20 s; a real runaway is still caught early (filler without spaces,
      // endless numbers) or past 12k characters.
      timeoutMs: 40_000,
      maxStringChars: 12_000,
    });
    if (result.ok) {
      const t = result.data;
      if (t.action === "design" && t.brief.trim().length < 40) {
        // A design without a brief can't be built; ask the model to try again.
        continue;
      }
      // Announcing questions and then not asking them leaves the owner guessing what the chips answer.
      if (t.action === "ask" && questionsMissing(t.message) && attempt < 2) continue;
      const questions = mergeQuestions(
        previous,
        t.questions.map(({ id, question, required, answer }) => ({
          id,
          question: named(question),
          required,
          answer: named(answer),
        })),
      );
      const shaped: InterviewTurn = {
        ...t,
        message: named(t.message),
        suggestions: t.action === "ask" ? t.suggestions.slice(0, 4) : [],
        questions,
        profile: t.profile.slice(0, 12).map((p) => ({ ...p, value: named(p.value) })),
        plan: t.plan.slice(0, 8).map(named),
      };
      const open = openRequired(questions);
      if (t.action === "design" && open.length) {
        // Designing with required answers missing builds a workspace on guesses; ask for them instead.
        console.info(JSON.stringify({ event: "interview_design_held", open: open.map((q) => q.id) }));
        held = { turn: shaped, open };
        prompt = `${base}\n\nYou set action to "design", but these required questions have no answer yet: ${open
          .map((q) => q.question)
          .join(" ")} Set action to "ask" and ask them again, with an example answer for each.`;
        continue;
      }
      const asked = new Set(t.questions.filter((q) => q.askNow).map((q) => q.id.trim().toLowerCase()));
      if (t.action === "ask" && open.length && !open.some((q) => asked.has(q.id.toLowerCase()))) {
        // Required questions are asked until answered; when Gemini moved on without them, they go below its reply.
        const again = open
          .slice(0, 3)
          .map((q, i) => `${i + 1}. ${q.question}`)
          .join("\n");
        shaped.message = `${shaped.message.trim()}\n\nI still need these before I can build it:\n\n${again}`;
      }
      return { ok: true, turn: shaped };
    }
    if (!result.retryable) return { ok: false, message: result.error };
  }
  if (held)
    return {
      ok: true,
      turn: {
        ...held.turn,
        action: "ask",
        brief: "",
        message: askAgainMessage(held.open),
        suggestions: [],
      },
    };
  return { ok: false, message: "Gemini didn't answer in time. Send your message again." };
}
