import "server-only";
import type { ChatTurn } from "@/lib/store/workspace-model";
import { generateJson } from "./gemini";
import { INTERVIEW_SYSTEM, type Turn, turn } from "./interview-prompt";

export type InterviewResult = { ok: true; turn: Turn } | { ok: false; message: string };

/** One step of the setup conversation: the next reply, or the brief to design from. */
export async function interviewTurn(messages: ChatTurn[]): Promise<InterviewResult> {
  const transcript = messages.map((m) => `${m.role === "user" ? "Owner" : "You"}: ${m.text}`).join("\n\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateJson(turn, {
      system: INTERVIEW_SYSTEM,
      prompt: `Conversation so far:\n\n${transcript}\n\nWrite your next turn.`,
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
