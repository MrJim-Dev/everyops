import "server-only";
import { attachmentNames, attachmentsIn } from "@/lib/assistant/attachments";
import { partialString } from "@/lib/partial-json";
import type { AskQuestion, ChatTurn, SetupQuestion } from "@/lib/store/workspace-model";
import { promptWithFiles } from "./attachments";
import { generateJsonHedged } from "./gemini";
import { INTERVIEW_SYSTEM, type Turn, turn } from "./interview-prompt";
import { referencesText, setupReferences } from "./references";
import {
  askAgainMessage,
  askList,
  mergeQuestions,
  openRequired,
  questionsMissing,
  withSystemNames,
} from "./setup-text";

export type InterviewTurn = Omit<Turn, "questions"> & {
  questions: SetupQuestion[];
  ask: AskQuestion[];
  suggestions: string[];
};
export type InterviewResult = { ok: true; turn: InterviewTurn } | { ok: false; message: string };

/** A reply while Gemini writes it: the message so far, then what it is writing after it. */
export type InterviewPartial = {
  message: string;
  /** After the message: the brief (a design turn) or the questions, profile and plan (an ask turn). */
  next?: "brief" | "questions";
};

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
  /** The reply as it streams in; `undefined` when a rejected answer is being written again. */
  onPartial?: (partial: InterviewPartial | undefined) => void,
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
  // The reply streams to the owner from whichever hedged twin is furthest along, a few times a second.
  let leader = -1;
  let longest = 0;
  let sentAt = 0;
  let sent = "";
  const onText = (text: string, attempt: number) => {
    if (!onPartial || (attempt !== leader && text.length <= longest)) return;
    leader = attempt;
    longest = text.length;
    const message = partialString(text, "message");
    if (!message?.value.trim()) return;
    const action = /"action"\s*:\s*"(ask|design)"/.exec(text)?.[1];
    const partial: InterviewPartial = {
      message: named(message.value),
      ...(message.done ? { next: action === "design" ? "brief" : "questions" } : {}),
    };
    const key = JSON.stringify(partial);
    if (key === sent || (Date.now() - sentAt < 120 && !message.done)) return;
    sent = key;
    sentAt = Date.now();
    onPartial(partial);
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      onPartial?.(undefined);
      leader = -1;
      longest = 0;
      sent = "";
    }
    // A full brief for a business with public pages, add-ons and payments runs 3–8k characters (every status and
    // list type spelled out) and takes 25–40 s on 3.7 Flash; a fixed 40 s limit cut such answers off while they
    // were still streaming and started over. A call is judged by its streaming instead: a twin starts after 15 s
    // without a part, a call silent for 15 s mid-answer (25 s before its first part) is stopped. A real runaway is
    // still caught early (filler without spaces, endless numbers) or past 12k characters.
    const result = await generateJsonHedged(
      turn,
      {
        system: INTERVIEW_SYSTEM,
        prompt,
        task: "interview",
        timeoutMs: 100_000,
        idleMs: 15_000,
        firstPartMs: 25_000,
        maxStringChars: 12_000,
        onText,
      },
      { hedgeMs: 15_000, attempts: 3, afterSilence: true },
    );
    if (result.ok) {
      const t = result.data;
      if (t.action === "design" && t.brief.trim().length < 40) {
        // A design without a brief can't be built; ask the model to try again.
        continue;
      }
      const askedNow = t.questions.filter((q) => q.askNow && !q.answer.trim());
      // Asking without any question to answer (or announcing ones it never gave) leaves the owner stuck.
      if (t.action === "ask" && !askedNow.length && questionsMissing(t.message) && attempt < 2) continue;
      const questions = mergeQuestions(
        previous,
        t.questions.map(({ id, question, required, answer, options }) => ({
          id,
          question: named(question),
          required,
          answer: named(answer),
          options: options.map(named).filter(Boolean).slice(0, 3),
        })),
      );
      const shaped: InterviewTurn = {
        ...t,
        message: named(t.message),
        suggestions: [],
        questions,
        ask: [],
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
      if (t.action === "ask")
        shaped.ask = askList(
          questions,
          askedNow.map((q) => q.id),
        );
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
        ask: askList(
          held.turn.questions,
          held.open.map((q) => q.id),
        ),
      },
    };
  return { ok: false, message: "Gemini didn't answer in time. Send your message again." };
}
