import "server-only";
import { attachmentNames, attachmentsIn } from "@/lib/assistant/attachments";
import type { ChatTurn } from "@/lib/store/workspace-model";
import { promptWithFiles } from "./attachments";
import { generateJson } from "./gemini";
import { INTERVIEW_SYSTEM, type Turn, turn } from "./interview-prompt";
import { referencesText, setupReferences } from "./references";
import { questionsMissing, withSystemNames } from "./setup-text";

export type InterviewResult = { ok: true; turn: Turn } | { ok: false; message: string };

/** One step of the setup conversation: the next reply, or the brief to design from. Files are the owner's own. */
export async function interviewTurn(
  messages: Pick<ChatTurn, "role" | "text" | "attachments">[],
  userId: string,
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
  const prompt = await promptWithFiles(
    userId,
    `${references}\n\nConversation so far:\n\n${transcript}`,
    attachmentsIn(messages),
    "Write your next turn.",
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateJson(turn, {
      system: INTERVIEW_SYSTEM,
      prompt,
      task: "interview",
      // A full brief for a business with public pages, add-ons and payments runs 3–6k characters and takes 10–20 s;
      // a real runaway is still caught early (filler without spaces, endless numbers) or past 9k characters.
      timeoutMs: 40_000,
      maxStringChars: 9000,
    });
    if (result.ok) {
      const t = result.data;
      if (t.action === "design" && t.brief.trim().length < 40) {
        // A design without a brief can't be built; ask the model to try again.
        continue;
      }
      // Announcing questions and then not asking them leaves the owner guessing what the chips answer.
      if (t.action === "ask" && questionsMissing(t.message) && attempt < 2) continue;
      return {
        ok: true,
        turn: {
          ...t,
          message: named(t.message),
          suggestions: t.action === "ask" ? t.suggestions.slice(0, 4) : [],
          profile: t.profile.slice(0, 12).map((p) => ({ ...p, value: named(p.value) })),
          plan: t.plan.slice(0, 8).map(named),
        },
      };
    }
    if (!result.retryable) return { ok: false, message: result.error };
  }
  return { ok: false, message: "Gemini didn't answer in time. Send your message again." };
}
