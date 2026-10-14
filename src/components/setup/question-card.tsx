"use client";

import { QuestionIcon, XIcon } from "@phosphor-icons/react";
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
 * Ask EveryOps's questions for this turn, answered one at a time like a short form: pick an option (the recommended
 * one first) or write your own under Other, then Next. Send goes out as one message. Closing it leaves a chip to
 * reopen it, and the composer stays free for a typed reply.
 */
export function QuestionCard({
  questions,
  onSend,
  disabled,
}: {
  questions: AskQuestion[];
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const otherBox = useRef<HTMLInputElement>(null);
  const q = questions[at];
  const choice = q ? picked[q.id] : undefined;
  const last = at === questions.length - 1;
  useEffect(() => {
    if (choice === OTHER) otherBox.current?.focus();
  }, [choice]);
  if (!q) return null;

  const answerOf = (id: string) => (picked[id] === OTHER ? (other[id] ?? "") : (picked[id] ?? ""));
  const answered = !!answerOf(q.id).trim();
  const finish = (next: Record<string, string>) => {
    const answers = Object.fromEntries(questions.map((x) => [x.id, next[x.id] ?? answerOf(x.id)]));
    onSend(answersMessage(questions, answers));
  };
  const advance = (skip: boolean) => {
    const next = skip ? { [q.id]: "" } : {};
    if (last) return finish(next);
    if (skip) setPicked((p) => ({ ...p, [q.id]: "" }));
    setAt(at + 1);
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="animate-rise mb-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <QuestionIcon className="size-3.5" />
        Answer {questions.length === 1 ? "1 question" : `${questions.length} questions`}
      </button>
    );

  const options = [
    ...q.options.map((o, i) => ({ id: o, label: i === 0 ? `${o} (Recommended)` : o })),
    { id: OTHER, label: "Other…" },
  ];
  return (
    <section
      aria-label="Questions from Ask EveryOps"
      className="animate-rise mb-2 rounded-xl border bg-card"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && answered && !disabled) {
          e.preventDefault();
          advance(false);
        }
      }}
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <fieldset className="min-w-0 flex-1">
          <legend className="text-[14px] font-medium text-pretty">
            {q.question}
            {q.required ? (
              <span className="ml-2 inline-flex rounded-full bg-warning/12 px-1.5 py-px align-[1px] text-[10.5px] font-medium text-warning">
                Required
              </span>
            ) : null}
          </legend>
          <div className="mt-3 flex flex-col gap-1">
            {options.map((o) => {
              const on = choice === o.id;
              return (
                <label
                  key={o.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors hover:bg-muted",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name={`ask-${q.id}`}
                    checked={on}
                    onChange={() => setPicked((p) => ({ ...p, [q.id]: o.id }))}
                    className="size-3.5 accent-primary"
                  />
                  {o.label}
                </label>
              );
            })}
            {choice === OTHER ? (
              <input
                ref={otherBox}
                aria-label="Your answer"
                placeholder="Type your answer"
                value={other[q.id] ?? ""}
                onChange={(e) => setOther((x) => ({ ...x, [q.id]: e.target.value }))}
                className="ml-8 mt-1 h-9 rounded-md border bg-background px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ) : null}
          </div>
        </fieldset>
        <button
          type="button"
          aria-label="Close questions"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t px-4 py-2.5">
        <span className="flex-1 text-[12.5px] tabular-nums text-muted-foreground">
          {at + 1} of {questions.length}
        </span>
        {at > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setAt(at - 1)}>
            Back
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => advance(true)}>
          Skip
        </Button>
        <Button
          size="sm"
          variant={answered ? "default" : "outline"}
          disabled={!answered || disabled}
          onClick={() => advance(false)}
        >
          {last ? "Send" : "Next"}
        </Button>
      </div>
    </section>
  );
}
