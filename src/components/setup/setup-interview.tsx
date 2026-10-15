"use client";

import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttachmentTray, ComposerTools, DropOverlay, MessageFiles } from "@/components/ai/composer-tools";
import { useAttachments } from "@/components/ai/use-attachments";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import { TypedRich } from "@/components/assistant/chat-thread";
import { Thinking } from "@/components/assistant/thinking";
import { LogoMark } from "@/components/brand/logo";
import { StarterChips } from "@/components/hub/starters";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { typingMs } from "@/hooks/use-typewriter";
import { type AttachmentRef, attachmentsIn } from "@/lib/assistant/attachments";
import type { DesignStreamEvent } from "@/lib/assistant/design-sketch";
import {
  type AskQuestion,
  type ChatTurn,
  type ProfileLine,
  type SetupDraft,
  type SetupProgress,
  type SetupQuestion,
  useWorkspaces,
} from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { type DesignBuild, DesignProgress } from "./design-progress";
import { AssistantMessage, UserMessage } from "./messages";
import { QuestionCard } from "./question-card";

type Phase = "idle" | "thinking" | "designing";
type Failure = { message: string; retry: () => void };

/**
 * The setup checklist beside the conversation: answered questions with the answer, then the ones still open.
 * Required ones are marked so the owner sees why EveryOps keeps asking them.
 */
function QuestionList({
  questions,
  onPick,
}: {
  questions: SetupQuestion[];
  /** Opens the question card on this question; absent while Ask EveryOps is working. */
  onPick?: (id: string) => void;
}) {
  const required = questions.filter((q) => q.required);
  const answered = required.filter((q) => q.answer.trim()).length;
  const open = questions.filter((q) => !q.answer.trim());
  const done = questions.filter((q) => q.answer.trim());
  return (
    <section aria-labelledby="setup-questions">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="setup-questions" className="text-[13px] font-semibold">
          Questions
        </h2>
        {required.length ? (
          <span
            className={cn(
              "text-[12px] tabular-nums",
              answered === required.length ? "text-primary" : "text-muted-foreground",
            )}
          >
            {answered} of {required.length} required answered
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5 text-[13px]">
        {[...open, ...done].map((q) => {
          const answer = q.answer.trim();
          return (
            <li key={q.id}>
              <button
                type="button"
                disabled={!onPick}
                onClick={() => onPick?.(q.id)}
                aria-label={`${answer ? "Change" : "Answer"}: ${q.question}`}
                className="-mx-2 flex w-[calc(100%+1rem)] gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,transform] duration-150 ease-out enabled:cursor-pointer enabled:active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)_and_(pointer:fine)]:enabled:hover:bg-muted"
              >
                {answer ? (
                  <CheckCircleIcon weight="fill" className="mt-0.5 size-3.5 shrink-0 text-primary" />
                ) : (
                  <CircleDashedIcon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      q.required ? "text-warning" : "text-muted-foreground",
                    )}
                  />
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={cn(answer && "text-muted-foreground")}>
                    {q.question}
                    {!answer ? (
                      <span
                        className={cn(
                          "ml-1.5 inline-flex rounded-full px-1.5 py-px align-[1px] text-[10.5px] font-medium",
                          q.required ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {q.required ? "Required" : "Optional"}
                      </span>
                    ) : null}
                  </span>
                  {answer ? <span className="text-foreground">{answer}</span> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Posts to a setup endpoint that answers in JSON lines and hands each line to onEvent until the final one
 * (type "done" or "error"), which it returns. Errors before the stream starts (sign-in, rate limit) come as JSON.
 */
async function streamLines<T extends { type: string }>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
): Promise<{ ok: true; last: T } | { ok: false; message: string }> {
  const dropped = "The connection dropped before EveryOps answered. Try again.";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, message: data?.message ?? "Something went wrong. Try again." };
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as T;
        if (event.type === "done" || event.type === "error") return { ok: true, last: event };
        onEvent(event);
      }
    }
    return { ok: false, message: dropped };
  } catch {
    return { ok: false, message: dropped };
  }
}

/** Asks for the design and follows its progress: the step, a sketch of the pages as they're written, then the draft. */
async function streamDesign(
  body: unknown,
  onEvent: (event: DesignStreamEvent) => void,
): Promise<{ ok: true; draft: SetupDraft } | { ok: false; message: string }> {
  const result = await streamLines<DesignStreamEvent>("/api/ai/design", body, onEvent);
  if (!result.ok) return result;
  const last = result.last;
  if (last.type === "done") return { ok: true, draft: last.draft as SetupDraft };
  return { ok: false, message: last.type === "error" ? last.message : "Something went wrong. Try again." };
}

/** A reply while Gemini writes it (see /api/ai/interview). */
type LiveReply = { message: string; next?: "brief" | "questions" };
type InterviewEvent =
  | { type: "partial"; partial: LiveReply | null }
  | { type: "ping" }
  | { type: "done"; result: ({ ok: true } & InterviewReply) | { ok: false; message: string } }
  | { type: "error"; message: string };

type InterviewReply = {
  turn: {
    action: "ask" | "design";
    message: string;
    suggestions: string[];
    questions?: SetupQuestion[];
    ask?: AskQuestion[];
    profile: ProfileLine[];
    plan?: string[];
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
      : // A blank workspace ("New workspace") starts with no message; the conversation starts with the first one.
        prompt || initialFiles?.length
        ? [{ role: "user", text: prompt, ...(initialFiles?.length ? { attachments: initialFiles } : {}) }]
        : [],
  );
  const [profile, setProfile] = useState<ProfileLine[]>(progress?.profile ?? []);
  const [plan, setPlan] = useState<string[]>(progress?.plan ?? []);
  const [questions, setQuestions] = useState<SetupQuestion[]>(progress?.questions ?? []);
  const [draft, setDraft] = useState<SetupDraft | undefined>(progress?.draft);
  const [phase, setPhase] = useState<Phase>("idle");
  const [build, setBuild] = useState<DesignBuild | null>(null);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [input, setInput] = useState("");
  const files = useAttachments();
  const voice = useVoiceInput((said) => setInput((v) => (v.trim() ? `${v.trimEnd()} ${said}` : said)));
  const scroller = useRef<HTMLDivElement>(null);
  useFollowBottom(scroller);
  const box = useRef<HTMLTextAreaElement>(null);
  // Replies already there when the page opens show whole; ones that arrive now type themselves out.
  const seen = useRef(messages.length);
  // Arrived just now from the home prompt (its one message, nothing answered yet): the page rises in to meet it.
  const fresh = useRef(messages.length === 1 && !progress?.messages?.length);
  useEffect(() => {
    delete document.documentElement.dataset.eoLeaving;
  }, []);
  const busy = phase !== "idle";

  useEffect(() => {
    saveSetup(ws.id, { messages, profile, plan, questions, draft });
  }, [saveSetup, ws.id, messages, profile, plan, questions, draft]);

  // Keep the latest message in view as the conversation grows.
  const turns = messages.length;
  useEffect(() => {
    if (turns || phase || draft || failure)
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, phase, draft, failure]);

  const design = useCallback(async (history: ChatTurn[], brief: string, workspaceName: string) => {
    setPhase("designing");
    setFailure(null);
    setBuild({ stage: "design", since: Date.now() });
    const result = await streamDesign(
      { brief, workspaceName, attachments: attachmentsIn(history).slice(-12) },
      (event) => {
        if (event.type === "stage")
          setBuild(
            (b) => b && { ...b, stage: event.stage, ...(event.issues ? { issues: event.issues } : {}) },
          );
        else if (event.type === "sketch") setBuild((b) => b && { ...b, sketch: event.sketch });
      },
    );
    setPhase("idle");
    setBuild(null);
    if (!result.ok)
      return setFailure({ message: result.message, retry: () => void design(history, brief, workspaceName) });
    const next = result.draft;
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
    async (history: ChatTurn[], checklist: SetupQuestion[]) => {
      setPhase("thinking");
      setFailure(null);
      setLive(null);
      let shown = false;
      const streamed = await streamLines<InterviewEvent>(
        "/api/ai/interview",
        {
          messages: history.map(({ role, text, attachments }) => ({ role, text, attachments })),
          questions: checklist,
        },
        (event) => {
          if (event.type !== "partial") return;
          shown = !!event.partial;
          setLive(event.partial);
        },
      );
      setLive(null);
      const result: { ok: true; data: InterviewReply } | { ok: false; message: string } = !streamed.ok
        ? streamed
        : streamed.last.type === "done" && streamed.last.result.ok
          ? { ok: true, data: streamed.last.result }
          : {
              ok: false,
              message:
                streamed.last.type === "error"
                  ? streamed.last.message
                  : streamed.last.type === "done" && !streamed.last.result.ok
                    ? streamed.last.result.message
                    : "Something went wrong. Try again.",
            };
      if (!result.ok) {
        setPhase("idle");
        return setFailure({ message: result.message, retry: () => void ask(history, checklist) });
      }
      const { turn } = result.data;
      if (turn.profile.length) setProfile(turn.profile);
      if (turn.plan?.length) setPlan(turn.plan);
      if (turn.questions?.length) setQuestions(turn.questions);
      const reply: ChatTurn = {
        role: "assistant",
        text: turn.message,
        suggestions: turn.action === "ask" && turn.suggestions.length ? turn.suggestions : undefined,
        ...(turn.action === "ask" && turn.ask?.length ? { ask: turn.ask } : {}),
        ...(turn.action === "design" ? { brief: turn.brief, workspaceName: turn.workspaceName } : {}),
      };
      const next = [...history, reply];
      // The reply was read as it streamed in: it shows whole instead of typing itself out again.
      if (shown) seen.current = next.length;
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
    if (last?.role === "user") void ask(messages, questions);
    else if (last?.brief && !draft) void design(messages, last.brief, last.workspaceName ?? "");
  }, [ask, design, messages, draft, questions]);

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
    void ask(next, questions);
  };

  const create = () => {
    if (!draft) return;
    const first = draft.data.blueprint.systems[0];
    const go = () => {
      finishSetup(ws.id, draft.data, draft.name, draft.summary);
      router.push(`/w/${ws.id}${first ? `/${first.id}` : ""}`);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return go();
    // The setup screen softens away, then the new workspace settles in (the shell clears the mark on arrival).
    document.documentElement.dataset.eoLeaving = "";
    setTimeout(go, 240);
  };

  const last = messages.at(-1);
  const waiting = !busy && !failure && last?.role === "assistant";
  const suggestions = waiting && !last.ask?.length ? (last.suggestions ?? []) : [];
  const turnAsk = waiting && !draft ? (last.ask ?? []) : [];
  // A question picked in the side panel opens the card on it: within this turn's questions when it's one of them,
  // otherwise on its own (an answered one can be changed this way).
  const [picked, setPicked] = useState<{ id: string; turn: number; nonce: number } | null>(null);
  const fromPanel = picked && picked.turn === messages.length ? picked : null;
  const pickedQuestion = fromPanel ? questions.find((q) => q.id === fromPanel.id) : undefined;
  const inTurn = fromPanel ? turnAsk.findIndex((q) => q.id === fromPanel.id) : -1;
  const asking: AskQuestion[] =
    pickedQuestion && inTurn < 0
      ? [
          {
            id: pickedQuestion.id,
            question: pickedQuestion.question,
            required: pickedQuestion.required,
            options: pickedQuestion.options ?? [],
            ...(pickedQuestion.answer.trim() ? { current: pickedQuestion.answer.trim() } : {}),
          },
        ]
      : turnAsk;
  const openQuestion = (id: string) => setPicked({ id, turn: messages.length, nonce: Date.now() });
  // Closing a card opened from the side panel brings back this turn's questions as the collapsed chip.
  const [collapsedTurn, setCollapsedTurn] = useState(-1);
  const closePanelCard = () => {
    setPicked(null);
    setCollapsedTurn(messages.length);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
      <div className="flex min-h-0 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-[680px] flex-col gap-5">
            {!messages.length && !busy ? (
              <div className="animate-rise flex flex-col items-center gap-4 pt-[12vh] text-center">
                <span className="flex size-11 items-center justify-center rounded-xl border bg-card">
                  <LogoMark className="size-5" />
                </span>
                <h2 className="text-balance text-[26px] font-semibold tracking-[-0.02em]">
                  What does your business need?
                </h2>
                <p className="max-w-[440px] text-pretty text-[14px] text-muted-foreground">
                  Describe how you work. EveryOps asks a few questions, then builds it here.
                </p>
                <StarterChips
                  className="mt-2"
                  onPick={(text) => {
                    setInput(text);
                    box.current?.focus();
                  }}
                />
              </div>
            ) : null}
            {messages.map((m, i) =>
              m.role === "user" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: messages only grow
                <div key={i} className={cn("flex flex-col gap-1.5", fresh.current && !i && "animate-rise")}>
                  <MessageFiles files={m.attachments} />
                  {m.text ? <UserMessage>{m.text}</UserMessage> : null}
                </div>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: messages only grow
                <AssistantMessage key={i}>
                  <TypedRich text={m.text} typing={i >= seen.current} />
                </AssistantMessage>
              ),
            )}

            {draft && !busy ? (
              <AssistantMessage>
                {/* The review card rises in once "Here's …" has typed out. */}
                <div
                  className={cn(
                    "rounded-xl border bg-card",
                    messages.length > seen.current && "animate-rise",
                  )}
                  style={
                    messages.length > seen.current
                      ? { animationDelay: `${typingMs(messages.at(-1)?.text ?? "")}ms` }
                      : undefined
                  }
                >
                  <div className="border-b px-4 py-3">
                    <p className="text-[14px] font-semibold">{draft.name}</p>
                    <p className="text-[12.5px] text-muted-foreground">{draft.summary}</p>
                  </div>
                  <ul className="divide-y">
                    {draft.coverage?.length ? (
                      <li className="rounded-md border border-primary/20 bg-primary/5 p-3">
                        <p className="mb-2 font-medium">
                          Brief checked · {draft.coverage.length} requirements
                        </p>
                        <ul className="space-y-1.5">
                          {draft.coverage.map((item) => (
                            <li key={item.request} className="flex gap-2">
                              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                              <span>
                                {item.request}
                                <span className="block text-muted-foreground">{item.detail}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ) : null}
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

            {phase === "thinking" && live ? (
              <AssistantMessage key="live">
                <TypedRich text={live.message} typing={false} />
                {live.next ? (
                  <div className="mt-3">
                    <Thinking
                      label={
                        live.next === "brief"
                          ? "Writing the plan for your workspace"
                          : "Getting your questions ready"
                      }
                      slowLabel={
                        live.next === "brief"
                          ? "Writing the plan for your workspace"
                          : "Getting your questions ready"
                      }
                    />
                  </div>
                ) : null}
              </AssistantMessage>
            ) : phase === "thinking" ? (
              <Thinking key="thinking" label="Thinking" avatar="round" />
            ) : phase === "designing" && build ? (
              <DesignProgress key="designing" build={build} />
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

        {/* No rule above the composer: the conversation fades under it instead, so the question card and the
            composer read as one floating surface. */}
        <div className="relative px-5 pt-1 pb-3 before:pointer-events-none before:absolute before:inset-x-0 before:-top-10 before:h-10 before:bg-linear-to-t before:from-background before:to-transparent">
          <form
            // The composer arrives from below with the first message, a beat after it.
            className={cn(
              "mx-auto w-full max-w-[680px]",
              fresh.current && "animate-rise [animation-delay:90ms]",
            )}
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            {...files.dropProps}
          >
            {asking.length ? (
              <QuestionCard
                key={`${messages.length}-${fromPanel?.nonce ?? 0}`}
                questions={asking}
                initialAt={Math.max(0, inTurn)}
                defaultOpen={!!fromPanel || (turnAsk.length > 0 && collapsedTurn !== messages.length)}
                autoFocus={!!fromPanel}
                onClose={fromPanel ? closePanelCard : undefined}
                disabled={busy}
                onSend={(text) => send(text, false)}
              />
            ) : null}
            <InputGroup className="relative h-auto">
              <DropOverlay attachments={files} />
              {files.items.length ? (
                <InputGroupAddon align="block-start" className="px-2.5 pt-2.5">
                  <AttachmentTray attachments={files} />
                </InputGroupAddon>
              ) : null}
              <InputGroupTextarea
                ref={box}
                autoFocus={!messages.length}
                aria-label="Message Ask EveryOps"
                placeholder={
                  draft
                    ? "Ask for changes before you create it…"
                    : messages.length
                      ? "Reply to EveryOps…"
                      : "I need a system to…"
                }
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
        {questions.length ? (
          <QuestionList questions={questions} onPick={!busy && !draft ? openQuestion : undefined} />
        ) : null}
        {plan.length ? (
          <section>
            <h2 className="mb-3 text-[13px] font-semibold">What EveryOps will set up</h2>
            <ul className="flex flex-col gap-2 text-[13px]">
              {plan.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
