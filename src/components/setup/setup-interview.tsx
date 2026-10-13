"use client";

import { ArrowUpIcon, CheckCircleIcon, CircleDashedIcon, SparkleIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { UseSystemDialog } from "@/components/community/use-system-dialog";
import { TypingIndicator } from "@/components/motion/typing-indicator";
import { SystemIcon } from "@/components/system-icon";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  type Answers,
  blueprintPreview,
  bookingSteps,
  buildBookingWorkspace,
  detectKind,
  profileLines,
  type Question,
  suggestedAnswers,
  suggestedSystem,
} from "@/lib/assistant/interview";
import { type SetupProgress, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { AssistantMessage, UserMessage } from "./messages";

/**
 * Ask EveryOps's first conversation. EveryOps asks at most three questions at a
 * time, keeps a readable profile on the right, and shows exactly what it will
 * build before anything is created.
 */
export function SetupInterview({ prompt, progress }: { prompt: string; progress?: SetupProgress }) {
  const ws = useWorkspace();
  const router = useRouter();
  const finishSetup = useWorkspaces((s) => s.finishSetup);
  const saveSetup = useWorkspaces((s) => s.saveSetup);
  const kind = detectKind(prompt);
  const steps = useMemo(() => bookingSteps(prompt), [prompt]);
  const [stepIndex, setStepIndex] = useState(progress?.stepIndex ?? 0);
  const [answers, setAnswers] = useState<Answers>(
    () => progress?.answers ?? { ...suggestedAnswers(steps.slice(0, 1)), name: "" },
  );
  const [notes, setNotes] = useState<string[]>(progress?.notes ?? []);
  const [draft, setDraft] = useState("");
  // A short "thinking" beat between steps keeps the conversation readable. It stays brief
  // (under a second) so it never feels like waiting.
  const [thinking, setThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Keep progress in the workspace so a refresh resumes where the owner left off.
  useEffect(() => {
    saveSetup(ws.id, { stepIndex, answers, notes });
  }, [saveSetup, ws.id, stepIndex, answers, notes]);
  const done = stepIndex >= steps.length;
  const built = useMemo(() => (done ? buildBookingWorkspace(answers, new Date()) : null), [done, answers]);

  if (kind !== "booking") {
    const system = suggestedSystem(kind);
    return (
      <Conversation prompt={prompt} notes={notes}>
        <AssistantMessage>
          {system ? (
            <div className="flex flex-col gap-3">
              <p>
                A good place to start is <strong className="font-medium">{system.name}</strong>, a community
                system you can use as is and then change in your own words.
              </p>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <SystemIcon name={system.icon} className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{system.name}</p>
                  <p className="text-[12.5px] text-muted-foreground">{system.summary}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <UseSystemDialog
                  systemId={system.id}
                  replaceSlug={ws.id}
                  trigger={<Button size="sm">Use {system.name}</Button>}
                />
                <Button size="sm" variant="ghost" onClick={() => router.push("/community")}>
                  Browse others
                </Button>
              </div>
            </div>
          ) : (
            <p>
              Tell me a bit more: what do you sell or book, and who uses the system day to day? Booking
              businesses get a guided setup in this preview.
            </p>
          )}
        </AssistantMessage>
      </Conversation>
    );
  }

  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const visible = step.questions.filter((q) => q.id !== "peak_rate" || answers.peak === "yes");
  // The business name is optional (EveryOps falls back to a placeholder); everything else needs an answer.
  const missing = visible.some(
    (q) => q.kind !== "text" && (answers[q.id] === undefined || answers[q.id] === ""),
  );
  const advance = (apply: () => void, building: boolean) => {
    setThinking(true);
    timer.current = setTimeout(
      () => {
        apply();
        setThinking(false);
      },
      building ? 700 : 450,
    );
  };
  const next = () =>
    advance(
      () => {
        const upcoming = steps[stepIndex + 1];
        if (upcoming) setAnswers((a) => ({ ...suggestedAnswers([upcoming]), ...a }));
        setStepIndex((i) => i + 1);
      },
      stepIndex + 1 >= steps.length,
    );
  const useDefaults = () =>
    advance(() => {
      setAnswers((a) => ({
        ...suggestedAnswers(steps),
        ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== "")),
      }));
      setStepIndex(steps.length);
    }, true);
  const create = () => {
    if (!built) return;
    const name = String(answers.name || "My venue");
    finishSetup(ws.id, built, name, "Bookings and payments");
    router.push(`/w/${ws.id}/bookings`);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
      <Conversation
        prompt={prompt}
        notes={notes}
        composer={
          <form
            className="mx-auto w-full max-w-[680px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              setNotes((n) => [...n, draft.trim()]);
              setDraft("");
            }}
          >
            <InputGroup className="h-11">
              <InputGroupInput
                aria-label="Add a note for EveryOps"
                placeholder="Add anything else I should know…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  aria-label="Send note"
                  disabled={!draft.trim()}
                >
                  <ArrowUpIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        }
      >
        {steps.slice(0, Math.min(stepIndex, steps.length)).map((s) => (
          <AssistantMessage key={s.id} muted>
            <span className="text-muted-foreground">{s.title}</span> · answered
          </AssistantMessage>
        ))}
        {notes.length ? <AssistantMessage>Noted. I'll keep that in your profile.</AssistantMessage> : null}

        {thinking ? (
          <AssistantMessage>
            <TypingIndicator
              label={stepIndex + 1 >= steps.length ? "Designing your workspace" : "EveryOps is thinking"}
            />
          </AssistantMessage>
        ) : !done ? (
          <AssistantMessage key={step.id}>
            <p className="mb-3">
              {stepIndex === 0 ? "Let's set up your bookings. A few quick questions." : step.intro}
            </p>
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 className="text-[14px] font-semibold">{step.title}</h2>
                <span className="text-[12px] text-muted-foreground tabular">
                  Step {stepIndex + 1} of {steps.length}
                </span>
              </div>
              <FieldGroup className="gap-5">
                {visible.map((q, i) => (
                  <div
                    key={q.id}
                    className="animate-rise stagger"
                    style={{ "--i": i + 1 } as React.CSSProperties}
                  >
                    <QuestionField
                      index={i + 1}
                      question={q}
                      value={answers[q.id]}
                      onChange={(value) => setAnswers((a) => ({ ...a, [q.id]: value }))}
                    />
                  </div>
                ))}
              </FieldGroup>
              <div className="mt-5 flex items-center gap-3 border-t pt-4">
                <Button onClick={next} disabled={missing}>
                  Continue
                </Button>
                <Button variant="ghost" onClick={useDefaults}>
                  Use suggested defaults
                </Button>
              </div>
            </div>
          </AssistantMessage>
        ) : built ? (
          <AssistantMessage>
            <p className="mb-3">Here's what I'll set up. You can change any of it later by asking.</p>
            <div className="rounded-xl border bg-card">
              <ul className="divide-y">
                {blueprintPreview(built).map((item) => (
                  <li key={item.label} className="flex gap-4 px-4 py-3 text-[13px]">
                    <span className="w-24 shrink-0 font-medium">{item.label}</span>
                    <span className="text-muted-foreground">{item.detail}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3 border-t px-4 py-3">
                <Button onClick={create}>
                  <SparkleIcon data-icon="inline-start" />
                  Create workspace
                </Button>
                <Button variant="ghost" onClick={() => setStepIndex(0)}>
                  Change answers
                </Button>
              </div>
            </div>
          </AssistantMessage>
        ) : null}
      </Conversation>

      <aside
        aria-label="Your workspace"
        className="hidden flex-col gap-6 overflow-y-auto border-l px-5 py-5 lg:flex"
      >
        <section>
          <h2 className="mb-3 text-[13px] font-semibold">Your workspace</h2>
          {profileLines(answers).filter((l) => l.value).length ? (
            <dl className="flex flex-col gap-2 text-[13px]">
              {profileLines(answers)
                .filter((l) => l.value)
                .map((line) => (
                  <div key={line.label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{line.label}</dt>
                    <dd className="text-right">{line.value}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className="text-[13px] text-muted-foreground">Answers appear here as you go.</p>
          )}
          {notes.length ? (
            <ul className="mt-3 flex flex-col gap-1 border-t pt-3 text-[12.5px] text-muted-foreground">
              {notes.map((n) => (
                <li key={n}>“{n}”</li>
              ))}
            </ul>
          ) : null}
        </section>
        <section>
          <h2 className="mb-3 text-[13px] font-semibold">Progress</h2>
          <ol className="flex flex-col gap-2 text-[13px]">
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={cn("flex items-center gap-2", i > stepIndex && "text-muted-foreground")}
              >
                {i < stepIndex ? (
                  <CheckCircleIcon className="size-4 animate-pop text-primary" />
                ) : (
                  <CircleDashedIcon className="size-4 text-muted-foreground" />
                )}
                {s.title}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] text-muted-foreground">Saved automatically on this device.</p>
        </section>
      </aside>
    </div>
  );
}

function Conversation({
  prompt,
  notes,
  children,
  composer,
}: {
  prompt: string;
  notes: string[];
  children: React.ReactNode;
  composer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex max-w-[680px] flex-col gap-5">
          <UserMessage>{prompt}</UserMessage>
          {notes.map((n) => (
            <UserMessage key={n}>{n}</UserMessage>
          ))}
          {children}
        </div>
      </div>
      {composer ? <div className="border-t px-5 py-3">{composer}</div> : null}
    </div>
  );
}

function QuestionField({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: Question;
  value: Answers[string] | undefined;
  onChange: (value: Answers[string]) => void;
}) {
  const id = `q-${question.id}`;
  const label = (
    <FieldLabel htmlFor={question.kind === "choice" ? undefined : id} className="gap-2 text-[13px]">
      <span
        aria-hidden="true"
        className="flex size-5 items-center justify-center rounded-full border font-mono text-[11px] text-muted-foreground"
      >
        {index}
      </span>
      {question.label}
    </FieldLabel>
  );
  switch (question.kind) {
    case "choice":
      return (
        <Field>
          {label}
          <ToggleGroup
            value={typeof value === "string" ? [value] : []}
            onValueChange={(v) => v[0] && onChange(v[0])}
            variant="outline"
            spacing={2}
            className="grid w-full grid-cols-2 sm:flex"
            aria-label={question.label}
          >
            {question.choices.map((c) => (
              <ToggleGroupItem
                key={c.id}
                value={c.id}
                className="h-9 flex-1 data-pressed:border-primary/60 data-pressed:bg-primary/10"
              >
                {c.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      );
    case "hours": {
      const hours = (value as { opens: string; closes: string }) ?? question.suggested;
      return (
        <Field>
          {label}
          <div className="grid grid-cols-2 gap-3">
            <Input
              id={id}
              type="time"
              aria-label="Opens"
              value={hours.opens}
              onChange={(e) => onChange({ ...hours, opens: e.target.value })}
            />
            <Input
              type="time"
              aria-label="Closes"
              value={hours.closes}
              onChange={(e) => onChange({ ...hours, closes: e.target.value })}
            />
          </div>
        </Field>
      );
    }
    case "money":
      return (
        <Field>
          {label}
          <InputGroup className="max-w-[200px]">
            <InputGroupAddon>
              <InputGroupText>₱</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={id}
              type="number"
              inputMode="decimal"
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </InputGroup>
        </Field>
      );
    default:
      return (
        <Field>
          {label}
          <Input
            id={id}
            placeholder={question.placeholder}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
  }
}
