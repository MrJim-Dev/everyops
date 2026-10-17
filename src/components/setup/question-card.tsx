"use client";

import { ArrowLeftIcon, QuestionIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AskQuestion } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

const OTHER = "__other__";

/** The owner's answers as the message Ask EveryOps reads: each question with its answer, skipped ones left out. */
export function answersMessage(questions: AskQuestion[], answers: Record<string, string>): string {
  const lines = questions
    .filter((q) => answers[q.id]?.trim())
    .map((q) => `${q.question}\n→ ${answers[q.id].trim()}`);
  return lines.length ? lines.join("\n\n") : "Skip these for now.";
}

/**
 * Ask EveryOps's questions, answered one at a time like a short form: pick an option (the recommended one first,
 * or press its number) and the card moves on to the next question by itself; Other opens a box for your own words,
 * then Next. The last question only selects: Send (or Enter) sends every answer as one message. Arrow keys move
 * between options without moving on. Closing it leaves a chip to reopen it, and the composer stays free for a typed
 * reply.
 *
 * Motion: a new question slides 12px in from the side you moved toward (200ms, strong ease-out); keyboard picks and
 * selection changes are instant, the chosen option shows for a moment before the next question, and reduced motion
 * keeps only the fade.
 */
export function QuestionCard({
  questions,
  initialAt = 0,
  defaultOpen = true,
  autoFocus = false,
  onClose,
  onSend,
  disabled,
}: {
  questions: AskQuestion[];
  initialAt?: number;
  defaultOpen?: boolean;
  /** Opened from the side panel: take focus so number keys and Enter work at once. */
  autoFocus?: boolean;
  /** Called instead of collapsing to the chip (a card opened from the side panel goes back to the turn's). */
  onClose?: () => void;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [at, setAt] = useState(Math.min(initialAt, questions.length - 1));
  const [dir, setDir] = useState<"next" | "back" | null>(null);
  // An answer it already has starts selected: its option, or Other with the words.
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      questions.flatMap((x) =>
        x.current ? [[x.id, x.options.includes(x.current) ? x.current : OTHER]] : [],
      ),
    ),
  );
  const [other, setOther] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      questions.flatMap((x) => (x.current && !x.options.includes(x.current) ? [[x.id, x.current]] : [])),
    ),
  );
  const otherBox = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLElement>(null);
  /** The pending move to the next question after a pick, so the chosen option shows first. */
  const moving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The last key was an arrow: browsing options, not choosing one. */
  const arrowing = useRef(false);
  const q = questions[at];
  const choice = q ? picked[q.id] : undefined;
  const last = at === questions.length - 1;
  useEffect(() => {
    if (choice === OTHER) otherBox.current?.focus();
  }, [choice]);
  useEffect(() => () => clearTimeout(moving.current), []);
  // Opened from the side panel: bring the card into view and let the keyboard work right away.
  useEffect(() => {
    if (open && autoFocus) card.current?.focus({ preventScroll: true });
  }, [open, autoFocus]);
  if (!q) return null;

  const answerOf = (id: string) => (picked[id] === OTHER ? (other[id] ?? "") : (picked[id] ?? ""));
  const answered = !!answerOf(q.id).trim();
  const go = (to: number) => {
    clearTimeout(moving.current);
    setDir(to > at ? "next" : "back");
    setAt(to);
  };
  /** Choosing an option answers the question; on every question but the last, the card then moves on. */
  const choose = (id: string) => {
    setPicked((p) => ({ ...p, [q.id]: id }));
    clearTimeout(moving.current);
    if (id === OTHER || last || disabled || arrowing.current) return;
    const from = at;
    moving.current = setTimeout(() => {
      setDir("next");
      setAt((now) => (now === from ? from + 1 : now));
    }, 220);
  };
  const advance = (skip: boolean) => {
    const next = skip ? { ...picked, [q.id]: "" } : picked;
    if (skip) setPicked(next);
    if (!last) return go(at + 1);
    const answers = Object.fromEntries(
      questions.map((x) => [x.id, next[x.id] === OTHER ? (other[x.id] ?? "") : (next[x.id] ?? "")]),
    );
    onSend(answersMessage(questions, answers));
  };
  const options = [...q.options.map((o) => ({ id: o, label: o })), { id: OTHER, label: "Other…" }];

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="enter-up mb-2 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground outline-none transition-[color,border-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)_and_(pointer:fine)]:hover:border-foreground/25 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
      >
        <QuestionIcon className="size-3.5" />
        Answer {questions.length === 1 ? "1 question" : `${questions.length} questions`}
      </button>
    );

  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-label="Questions from Ask EveryOps"
      className="enter-up mb-2 overflow-hidden rounded-2xl border bg-card shadow-[0_12px_32px_-16px_rgb(0_0_0/0.6)] outline-none"
      onKeyDown={(e) => {
        arrowing.current = e.key.startsWith("Arrow");
        if (e.target instanceof HTMLInputElement && e.target.type === "text") {
          if (e.key === "Enter" && answered && !disabled) {
            e.preventDefault();
            advance(false);
          }
          return;
        }
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) {
          e.preventDefault();
          choose(options[n - 1].id);
        } else if (e.key === "Enter" && answered && !disabled) {
          e.preventDefault();
          advance(false);
        } else if (e.key === "Escape") (onClose ?? (() => setOpen(false)))();
      }}
      onPointerDown={() => {
        arrowing.current = false;
      }}
    >
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <div className="flex flex-1 items-center gap-2.5">
          <div aria-hidden="true" className="flex gap-1">
            {questions.map((x, i) => (
              <span
                key={x.id}
                className={cn(
                  "h-1 w-5 rounded-full transition-colors duration-200",
                  i < at ? "bg-primary/60" : i === at ? "bg-primary" : "bg-muted-foreground/20",
                )}
              />
            ))}
          </div>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {at + 1} of {questions.length}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close questions"
          onClick={() => (onClose ? onClose() : setOpen(false))}
          className="-mr-1 rounded-md p-1 text-muted-foreground outline-none transition-[color,transform] duration-150 ease-out active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <fieldset
        key={q.id}
        className={cn(
          "px-4 pt-3 motion-reduce:animate-none",
          dir === "next" && "animate-step-next",
          dir === "back" && "animate-step-back",
        )}
      >
        <legend className="float-left w-full text-pretty text-[15px] font-medium leading-snug">
          {q.question}
          {q.required ? (
            <span className="ml-2 inline-flex rounded-full bg-warning/12 px-1.5 py-px align-[2px] text-[10.5px] font-medium text-warning">
              Required
            </span>
          ) : null}
        </legend>
        <div className="clear-both flex flex-col gap-1 pt-3">
          {options.map((o, i) => {
            const on = choice === o.id;
            return (
              <label
                key={o.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[13.5px] transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.99] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  on
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
                )}
              >
                <input
                  type="radio"
                  name={`ask-${q.id}`}
                  checked={on}
                  onChange={() => choose(o.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                    on ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full bg-primary transition-[opacity,transform] duration-150 ease-out",
                      on ? "scale-100 opacity-100" : "scale-50 opacity-0",
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  {o.label}
                  {q.current && o.id === q.current ? (
                    <span className="ml-2 text-[11.5px] text-muted-foreground">Current answer</span>
                  ) : i === 0 && o.id !== OTHER && !q.current && !q.neutral ? (
                    <span className="ml-2 text-[11.5px] text-primary">Recommended</span>
                  ) : null}
                </span>
                <kbd className="hidden rounded border px-1.5 text-[10.5px] text-muted-foreground/70 tabular-nums sm:inline">
                  {i + 1}
                </kbd>
              </label>
            );
          })}
          {choice === OTHER ? (
            <input
              ref={otherBox}
              aria-label="Your answer"
              placeholder="Type your answer, then press Enter"
              value={other[q.id] ?? ""}
              onChange={(e) => setOther((x) => ({ ...x, [q.id]: e.target.value }))}
              className="enter-up mt-1 ml-10 h-10 rounded-lg border bg-background px-3 text-[13.5px] outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          ) : null}
        </div>
      </fieldset>

      <div className="flex items-center gap-1.5 px-4 pt-3 pb-3.5">
        {at > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => go(at - 1)}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => advance(true)}
          className="text-muted-foreground"
        >
          Skip
        </Button>
        <Button
          size="sm"
          disabled={!answered || disabled}
          onClick={() => advance(false)}
          className="min-w-16"
        >
          {last ? "Send" : "Next"}
        </Button>
      </div>
    </section>
  );
}
