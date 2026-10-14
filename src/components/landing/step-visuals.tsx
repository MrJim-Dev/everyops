"use client";

import {
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUUpLeftIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  CheckIcon,
  HandCoinsIcon,
  MapPinIcon,
  MicrophoneIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode } from "react";
import { LogoMark, LogoMarkThinking } from "@/components/brand/logo";
import { SystemShot } from "@/components/community/system-shot";
import { CATALOG } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { useScene, useTyped } from "./use-scene";

export type StepVisualProps = { active: boolean };

/** A screen of the product: a slim title bar naming it, then the scene. */
function Screen({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card/70 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-[12px] text-muted-foreground">
        <LogoMark className="size-3 text-foreground" />
        <span className="font-medium text-foreground">{title}</span>
        {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
      </div>
      <div className={cn("relative flex min-h-0 flex-1 flex-col p-5", className)}>{children}</div>
    </div>
  );
}

/** Fades and lifts in when `on`; the scene's single entrance. */
function Appear({ on, className, children }: { on: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      data-on={on}
      className={cn(
        "transition-[opacity,transform] duration-300 ease-(--ease-out-strong) data-[on=false]:translate-y-1.5 data-[on=false]:opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Bubble({
  from,
  children,
  className,
}: {
  from: "you" | "ai";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-fit max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
        from === "you" ? "ml-auto rounded-br-md bg-secondary" : "rounded-bl-md border bg-background/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* 1. Describe: the sentence types itself, and each fact it carries is picked up as it's written. */

const SENTENCE: { text: string; fact?: number }[] = [
  { text: "We run a pickleball venue in " },
  { text: "Cebu", fact: 0 },
  { text: " with " },
  { text: "4 courts", fact: 1 },
  { text: ". People " },
  { text: "book by the hour", fact: 2 },
  { text: " and " },
  { text: "pay at the counter", fact: 3 },
  { text: "." },
];
const SENTENCE_LENGTH = SENTENCE.reduce((n, s) => n + s.text.length, 0);
// In the order the sentence mentions them, so each chip lands next to the last one.
const FACTS = [
  { label: "Cebu, in pesos", Icon: MapPinIcon },
  { label: "4 courts", Icon: SquaresFourIcon },
  { label: "Bookings by the hour", Icon: CalendarBlankIcon },
  { label: "Pay at the counter", Icon: HandCoinsIcon },
];

export function DescribeVisual({ active }: StepVisualProps) {
  const typed = useTyped(active, SENTENCE_LENGTH);
  const done = typed >= SENTENCE_LENGTH;
  const found = new Set<number>();
  let at = 0;
  const parts = SENTENCE.map((s) => {
    const shown = s.text.slice(0, Math.max(0, typed - at));
    at += s.text.length;
    const complete = typed >= at;
    if (s.fact !== undefined && complete) found.add(s.fact);
    return { ...s, shown, complete };
  });
  return (
    <Screen title="New workspace" className="justify-center gap-6">
      <div
        className={cn(
          "rounded-xl border bg-background/70 p-4 transition-[border-color,box-shadow] duration-300",
          active && "border-primary/30 shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_10%,transparent)]",
        )}
      >
        <p className="min-h-[72px] text-[15px] leading-relaxed">
          <span className="sr-only">{SENTENCE.map((s) => s.text).join("")}</span>
          <span aria-hidden="true">
            {parts.map((p, i) =>
              p.fact !== undefined ? (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed sentence
                  key={i}
                  className={cn(
                    "rounded-[4px] transition-colors duration-300",
                    p.complete && "bg-primary/14 text-foreground",
                  )}
                >
                  {p.shown}
                </span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed sentence
                <Fragment key={i}>{p.shown}</Fragment>
              ),
            )}
            {!done ? (
              <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-primary" />
            ) : null}
          </span>
        </p>
        <div className="mt-3 flex items-center gap-3 text-muted-foreground">
          <PaperclipIcon className="size-4" />
          <MicrophoneIcon className="size-4" />
          <span
            className={cn(
              "ml-auto flex size-7 items-center justify-center rounded-full transition-colors duration-300",
              done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            <ArrowUpIcon weight="bold" className="size-3.5" />
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-muted-foreground">What EveryOps picked up</p>
        <div className="flex min-h-[60px] flex-wrap content-start gap-2">
          {FACTS.map(({ label, Icon }, i) => (
            <Appear key={label} on={found.has(i)}>
              <span className="flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-[12px]">
                <Icon className="size-3.5 text-primary" />
                {label}
              </span>
            </Appear>
          ))}
        </div>
      </div>
    </Screen>
  );
}

/* 2. Answer: the questions it needs, one at a time, with quick replies. */

const ANSWER_BEATS = [300, 700, 800, 900, 450, 700] as const;

export function AnswerVisual({ active }: StepVisualProps) {
  const stage = useScene(active, ANSWER_BEATS);
  const question = stage >= 5 ? 4 : 3;
  return (
    <Screen
      title="Ask EveryOps"
      aside={
        <>
          <span className="tabular">Question {question} of 5</span>
          <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-(--ease-out-strong)"
              style={{ transform: `scaleX(${question / 5})` }}
            />
          </span>
        </>
      }
      className="justify-end gap-2.5"
    >
      <Appear on={stage >= 1}>
        <Bubble from="ai">What hours are the courts open?</Bubble>
      </Appear>
      <Appear on={stage >= 2}>
        <Bubble from="you">6 AM to 10 PM, every day</Bubble>
      </Appear>
      <Appear on={stage >= 3}>
        <Bubble from="ai">Do weekend rates differ from weekdays?</Bubble>
      </Appear>
      <div className="grid min-h-[38px] justify-items-end">
        <Appear on={stage >= 3 && stage < 5} className="col-start-1 row-start-1 flex gap-1.5">
          {["Same every day", "Weekends cost more"].map((reply, i) => (
            <span
              key={reply}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-200",
                i === 1 && stage >= 4
                  ? "border-primary/50 bg-primary/14 text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {reply}
            </span>
          ))}
        </Appear>
        <Appear on={stage >= 5} className="col-start-1 row-start-1 w-full">
          <Bubble from="you">Weekends cost more: ₱450 on weekdays, ₱600 on weekends</Bubble>
        </Appear>
      </div>
      <Appear on={stage >= 6} className="flex items-center gap-2.5 text-[13px]">
        <LogoMarkThinking className="size-3.5 text-primary" />
        <span className="shimmer-text animate-shimmer bg-clip-text font-medium text-transparent motion-reduce:animate-none">
          Designing your system
        </span>
      </Appear>
    </Screen>
  );
}

/* 3. Run: the workspace builds itself, then comes into focus with sample data. */

const BUILD = ["Booking calendar", "Courts and rates", "Public booking page", "24 sample bookings"];
const RUN_BEATS = [350, 550, 550, 550, 450] as const;

function BuildMark({ state }: { state: "waiting" | "working" | "done" }) {
  if (state === "done") return <CheckCircleIcon weight="fill" className="size-4 shrink-0 text-primary" />;
  return (
    <span
      className={cn(
        "size-3.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/40",
        state === "working" && "animate-spin border-primary border-t-transparent motion-reduce:animate-none",
      )}
    />
  );
}

export function RunVisual({ active }: StepVisualProps) {
  const system = CATALOG[0];
  const stage = useScene(active, RUN_BEATS);
  const ready = stage > BUILD.length;
  return (
    <Screen
      title="Court House PH"
      aside={
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] transition-colors duration-300",
            ready ? "bg-primary/14 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {ready ? <CheckIcon weight="bold" className="size-3" /> : null}
          {ready ? "Ready" : "Setting up"}
        </span>
      }
      className="p-0"
    >
      <div
        className={cn(
          "min-h-0 flex-1 overflow-hidden transition-[opacity,filter] duration-500 ease-(--ease-out-strong)",
          ready ? "opacity-100" : "opacity-35 blur-[2px]",
        )}
      >
        <SystemShot system={system} />
      </div>
      <div
        data-on={!ready}
        className="absolute inset-x-4 bottom-4 rounded-xl border bg-popover/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur transition-[opacity,transform] duration-300 ease-(--ease-out-strong) data-[on=false]:translate-y-2 data-[on=false]:opacity-0"
      >
        <p className="mb-2.5 text-[12.5px] font-medium">Building your workspace</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
          {BUILD.map((item, i) => (
            <li key={item} className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <BuildMark state={stage > i + 1 ? "done" : stage === i + 1 ? "working" : "waiting"} />
              <span className={cn("truncate transition-colors", stage > i + 1 && "text-foreground")}>
                {item}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Screen>
  );
}

/* 4. Change: ask in plain words, review the plan, apply it, and keep the way back. */

const CHANGE_BEATS = [300, 750, 1300, 160] as const;

export function ChangeVisual({ active }: StepVisualProps) {
  const stage = useScene(active, CHANGE_BEATS);
  const applied = stage >= 4;
  return (
    <Screen title="Ask EveryOps" className="justify-center gap-4">
      <Appear on={stage >= 1}>
        <Bubble from="you">Make weekend rates ₱600 and add a field for paddle rentals</Bubble>
      </Appear>
      <Appear
        on={stage >= 2}
        className={cn(
          "rounded-xl border bg-background/70 transition-[opacity,transform,border-color] duration-300",
          applied && "border-primary/35",
        )}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/14 text-primary">
            <SparkleIcon weight="fill" className="size-3.5" />
          </span>
          <span className="min-w-0 truncate text-[13px] font-medium">Weekend rate and paddles</span>
          <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">2 changes</span>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3 text-[13px]">
          <div className="flex items-center gap-2.5">
            <span className="flex size-5 items-center justify-center rounded-full bg-warning/14 text-warning">
              <PencilSimpleIcon className="size-3" />
            </span>
            <span>Weekend rate</span>
            <span className="ml-auto flex items-center gap-1.5 tabular">
              <span className="text-muted-foreground line-through">₱450</span>
              <ArrowRightIcon className="size-3 text-muted-foreground" />
              <span className="font-medium">₱600</span>
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/14 text-primary">
              <PlusIcon className="size-3" />
            </span>
            <span>Paddle rental</span>
            <span className="ml-auto text-muted-foreground">New field on Bookings</span>
          </div>
        </div>
        <div className="grid border-t px-4 py-2.5 text-[12px]">
          <div
            data-on={!applied}
            className="col-start-1 row-start-1 flex items-center gap-2 transition-opacity duration-200 data-[on=false]:opacity-0"
          >
            <span
              className={cn(
                "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-transform duration-150 ease-out",
                stage === 3 && "scale-[0.96]",
              )}
            >
              Apply
            </span>
            <span className="px-1.5 text-muted-foreground">Not now</span>
            <span className="ml-auto text-muted-foreground">Nothing changes until you apply</span>
          </div>
          <div
            data-on={applied}
            className="col-start-1 row-start-1 flex items-center gap-1.5 text-primary transition-opacity duration-200 data-[on=false]:opacity-0"
          >
            <CheckIcon weight="bold" className="size-3.5" />
            Applied and saved to History
            <span className="ml-auto flex items-center gap-1 text-foreground">
              <ArrowUUpLeftIcon className="size-3.5" />
              Undo
            </span>
          </div>
        </div>
      </Appear>
    </Screen>
  );
}
