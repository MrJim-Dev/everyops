import "server-only";
import { attachmentNames, attachmentsIn } from "@/lib/assistant/attachments";
import type { ChatTurn } from "@/lib/store/workspace-model";
import { promptWithFiles } from "./attachments";
import { generateJson } from "./gemini";
import { INTERVIEW_SYSTEM, type Turn, turn } from "./interview-prompt";

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
  const prompt = await promptWithFiles(
    userId,
    `Conversation so far:\n\n${transcript}`,
    attachmentsIn(messages),
    "Write your next turn.",
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateJson(turn, {
      system: INTERVIEW_SYSTEM,
      prompt,
      task: "interview",
    });
    if (result.ok) {
      const t = result.data;
      if (t.action === "design" && t.brief.trim().length < 40) {
        // A design without a brief can't be built; ask the model to try again.
        continue;
      }
      return {
        ok: true,
        turn: {
          ...t,
          suggestions: t.action === "ask" ? t.suggestions.slice(0, 4) : [],
          profile: t.profile.slice(0, 12),
        },
      };
    }
    if (!result.retryable) return { ok: false, message: result.error };
  }
  return { ok: false, message: "Gemini didn't answer in time. Send your message again." };
}
