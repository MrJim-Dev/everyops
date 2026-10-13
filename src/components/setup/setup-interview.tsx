"use client";

import { ArrowClockwiseIcon, ArrowUpIcon, SparkleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttachmentTray, ComposerTools, MessageFiles } from "@/components/ai/composer-tools";
import { useAttachments } from "@/components/ai/use-attachments";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import { TypingIndicator } from "@/components/motion/typing-indicator";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { type AttachmentRef, attachmentsIn } from "@/lib/assistant/attachments";
import {
  type ChatTurn,
  type ProfileLine,
  type SetupDraft,
  type SetupProgress,
  useWorkspaces,
} from "@/lib/store/workspaces";
import { AssistantMessage, UserMessage } from "./messages";

type Phase = "idle" | "thinking" | "designing";
type Failure = { message: string; retry: () => void };

async function post<T>(
  url: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
    if (res.ok && data?.ok) return { ok: true, data };
    return { ok: false, message: data?.message ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, message: "You seem to be offline. Check your connection and try again." };
  }
}

type InterviewReply = {
  turn: {
    action: "ask" | "design";
    message: string;
    suggestions: string[];
    profile: ProfileLine[];
    workspaceName: string;
    brief: string;
  };
};

/**
 * Ask EveryOps's setup conversation. Gemini interviews the owner, keeps a profile of the business,
 * then designs the workspace; nothing is created until the owner reviews it and presses Create.
 * The conversation is saved with the workspace, so it continues after a refresh or on another device.
 */
export function SetupInterview({
  prompt,
  attachments: initialFiles,
  progress,
}: {
  prompt: string;
  attachments?: AttachmentRef[];
  progress?: SetupProgress;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const saveSetup = useWorkspaces((s) => s.saveSetup);
  const finishSetup = useWorkspaces((s) => s.finishSetup);
  const [messages, setMessages] = useState<ChatTurn[]>(() =>
    progress?.messages?.length
      ? progress.messages
      : [{ role: "user", text: prompt, ...(initialFiles?.length ? { attachments: initialFiles } : {}) }],
  );
  const [profile, setProfile] = useState<ProfileLine[]>(progress?.profile ?? []);
  const [draft, setDraft] = useState<SetupDraft | undefined>(progress?.draft);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [input, setInput] = useState("");
  const files = useAttachments();
  const voice = useVoiceInput((said) => setInput((v) => (v.trim() ? `${v.trimEnd()} ${said}` : said)));
  const scroller = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle";

  useEffect(() => {
    saveSetup(ws.id, { messages, profile, draft });
  }, [saveSetup, ws.id, messages, profile, draft]);

  // Keep the latest message in view as the conversation grows.
  const turns = messages.length;
  useEffect(() => {
    if (turns || phase || draft || failure)
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, phase, draft, failure]);

  const design = useCallback(async (history: ChatTurn[], brief: string, workspaceName: string) => {
    setPhase("designing");
    setFailure(null);
    const result = await post<{ draft: SetupDraft }>("/api/ai/design", {
      brief,
      workspaceName,
      attachments: attachmentsIn(history).slice(-12),
    });
    setPhase("idle");
    if (!result.ok)
      return setFailure({ message: result.message, retry: () => void design(history, brief, workspaceName) });
    const next = result.data.draft;
    setDraft(next);
    setMessages([
      ...history,
      {
        role: "assistant",
        text: `Here's ${next.name}. Review it below, then create it, or tell me what to change.`,
      },
    ]);
  }, []);

  const ask = useCallback(
    async (history: ChatTurn[]) => {
      setPhase("thinking");
      setFailure(null);
      const result = await post<InterviewReply>("/api/ai/interview", {
        messages: history.map(({ role, text, attachments }) => ({ role, text, attachments })),
      });
      if (!result.ok) {
        setPhase("idle");
        return setFailure({ message: result.message, retry: () => void ask(history) });
      }
      const { turn } = result.data;
      if (turn.profile.length) setProfile(turn.profile);
      const reply: ChatTurn = {
        role: "assistant",
        text: turn.message,
        suggestions: turn.action === "ask" ? turn.suggestions : undefined,
        ...(turn.action === "design" ? { brief: turn.brief, workspaceName: turn.workspaceName } : {}),
      };
      const next = [...history, reply];
      setMessages(next);
      if (turn.action === "design") await design(next, turn.brief, turn.workspaceName);
      else setPhase("idle");
    },
    [design],
  );

  // Pick up where the conversation stopped: an unanswered message, or a design that never finished.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const last = messages.at(-1);
    if (last?.role === "user") void ask(messages);
    else if (last?.brief && !draft) void design(messages, last.brief, last.workspaceName ?? "");
  }, [ask, design, messages, draft]);

  const send = (text: string, withFiles = true) => {
    const clean = text.trim();
    const sent = withFiles ? files.refs : [];
    if ((!clean && !sent.length) || busy || (withFiles && files.uploading)) return;
    const next: ChatTurn[] = [
      ...messages,
      { role: "user", text: clean, ...(sent.length ? { attachments: sent } : {}) },
    ];
    setMessages(next);
    setInput("");
    if (withFiles) files.clear();
    void ask(next);
  };

  const create = () => {
    if (!draft) return;
    finishSetup(ws.id, draft.data, draft.name, draft.summary);
    const first = draft.data.blueprint.systems[0];
    router.push(`/w/${ws.id}${first ? `/${first.id}` : ""}`);
  };

  const last = messages.at(-1);
  const suggestions = !busy && !failure && last?.role === "assistant" ? (last.suggestions ?? []) : [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
      <div className="flex min-h-0 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-[680px] flex-col gap-5">
            {messages.map((m, i) =>
              m.role === "user" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: messages only grow
                <div key={i} className="flex flex-col gap-1.5">
                  <MessageFiles files={m.attachments} />
                  {m.text ? <UserMessage>{m.text}</UserMessage> : null}
                </div>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: messages only grow
                <AssistantMessage key={i}>
                  <p className="whitespace-pre-line">{m.text}</p>
                </AssistantMessage>
              ),
            )}

            {draft && !busy ? (
              <AssistantMessage>
                <div className="rounded-xl border bg-card">
                  <div className="border-b px-4 py-3">
                    <p className="text-[14px] font-semibold">{draft.name}</p>
                    <p className="text-[12.5px] text-muted-foreground">{draft.summary}</p>
                  </div>
                  <ul className="divide-y">
                    {draft.preview.map((item) => (
                      <li key={item.label} className="flex gap-4 px-4 py-3 text-[13px]">
                        <span className="w-28 shrink-0 font-medium">{item.label}</span>
                        <span className="text-muted-foreground">{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
                    <Button onClick={create}>
                      <SparkleIcon data-icon="inline-start" />
                      Create workspace
                    </Button>
                    <span className="text-[12px] text-muted-foreground">
                      Designed by Gemini and checked by EveryOps. You can change anything later.
                    </span>
                  </div>
                </div>
              </AssistantMessage>
            ) : null}

            {phase === "thinking" ? (
              <AssistantMessage>
                <TypingIndicator label="EveryOps is thinking" />
              </AssistantMessage>
            ) : phase === "designing" ? (
              <AssistantMessage>
                <TypingIndicator label="Designing your workspace. This takes about 20 seconds" />
              </AssistantMessage>
            ) : null}

            {failure ? (
              <AssistantMessage>
                <div role="alert" className="flex flex-col items-start gap-2">
                  <p className="text-warning">{failure.message}</p>
                  <Button size="sm" variant="outline" onClick={failure.retry}>
                    <ArrowClockwiseIcon data-icon="inline-start" />
                    Try again
                  </Button>
                </div>
              </AssistantMessage>
            ) : null}

            {suggestions.length ? (
              <div className="flex flex-wrap gap-2 pl-10">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s, false)}
                    className="animate-rise rounded-full border px-3 py-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t px-5 py-3">
          <form
            className="mx-auto w-full max-w-[680px]"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            onDragOver={files.onDragOver}
            onDrop={files.onDrop}
          >
            <InputGroup className="h-auto">
              {files.items.length ? (
                <InputGroupAddon align="block-start" className="px-2.5 pt-2.5">
                  <AttachmentTray attachments={files} />
                </InputGroupAddon>
              ) : null}
              <InputGroupTextarea
                aria-label="Message Ask EveryOps"
                placeholder={draft ? "Ask for changes before you create it…" : "Reply to EveryOps…"}
                value={input}
                rows={1}
                className="max-h-40 min-h-11 px-3.5 py-3 text-[14px]"
                onChange={(e) => setInput(e.target.value)}
                onPaste={files.onPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              <InputGroupAddon align="block-end" className="justify-between px-2 pb-2">
                <ComposerTools attachments={files} voice={voice} disabled={busy} />
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  aria-label="Send"
                  disabled={(!input.trim() && !files.refs.length) || busy || files.uploading}
                >
                  <ArrowUpIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>
      </div>

      <aside
        aria-label="Your business"
        className="hidden flex-col gap-6 overflow-y-auto border-l px-5 py-5 lg:flex"
      >
        <section>
          <h2 className="mb-3 text-[13px] font-semibold">What EveryOps knows</h2>
          {profile.length ? (
            <dl className="flex flex-col gap-2.5 text-[13px]">
              {profile.map((line) => (
                <div key={line.label} className="flex flex-col gap-0.5">
                  <dt className="text-[12px] text-muted-foreground">{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] text-muted-foreground">Details appear here as you chat.</p>
          )}
        </section>
        <section className="text-[12.5px] text-muted-foreground">
          <p>Saved to your account as you go.</p>
          <p className="mt-2">
            Prefer a ready-made system?{" "}
            <Link href="/community" className="text-foreground underline-offset-4 hover:underline">
              Browse Community
            </Link>
          </p>
        </section>
      </aside>
    </div>
  );
}
