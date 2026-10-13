"use client";

import { ArrowRightIcon, CheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { SystemShot } from "@/components/community/system-shot";
import { CATALOG } from "@/lib/catalog";
import { cn } from "@/lib/utils";

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-foreground/10 bg-card/70 p-5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Bubble({ from, children }: { from: "you" | "ai"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
        from === "you"
          ? "self-end rounded-br-md bg-primary/14 text-foreground"
          : "self-start rounded-bl-md border bg-background/70",
      )}
    >
      {children}
    </div>
  );
}

export function DescribeVisual() {
  return (
    <Panel className="justify-center gap-5">
      <div className="rounded-xl border border-primary/30 bg-background/70 p-4 text-[15px] leading-relaxed shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_10%,transparent)]">
        We run a pickleball venue in Cebu with 4 courts. People book by the hour and pay at the counter.
        <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-primary" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-muted-foreground">What EveryOps picked up</p>
        <div className="flex flex-wrap gap-2">
          {["Bookings by the hour", "4 courts", "Pay at the counter", "Cebu, PHP"].map((tag) => (
            <span key={tag} className="rounded-full border bg-background/60 px-2.5 py-1 text-[12px]">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function AnswerVisual() {
  return (
    <Panel className="justify-center gap-3">
      <Bubble from="ai">What hours are the courts open?</Bubble>
      <Bubble from="you">6 AM to 10 PM, every day</Bubble>
      <Bubble from="ai">Do weekend rates differ from weekdays?</Bubble>
      <Bubble from="you">Yes. ₱450 on weekdays, ₱600 on weekends</Bubble>
      <div className="flex items-center gap-1 self-start rounded-2xl rounded-bl-md border bg-background/70 px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-typing rounded-full bg-muted-foreground"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </div>
    </Panel>
  );
}

export function RunVisual() {
  const system = CATALOG[0];
  return (
    <Panel className="gap-4">
      <div className="overflow-hidden rounded-lg border">
        <SystemShot system={system} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {system.includes.map((item) => (
          <span key={item} className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <CheckIcon weight="bold" className="size-3.5 text-primary" />
            {item}
          </span>
        ))}
      </div>
    </Panel>
  );
}

export function ChangeVisual() {
  return (
    <Panel className="justify-center gap-4">
      <Bubble from="you">Make weekend rates ₱600 and add a field for paddle rentals</Bubble>
      <div className="rounded-xl border bg-background/70">
        <p className="flex items-center gap-1.5 border-b px-4 py-2.5 text-[12px] text-primary">
          <SparkleIcon weight="fill" className="size-3.5" />2 changes, ready to review
        </p>
        <div className="flex flex-col gap-2.5 px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Weekend rate</span>
            <span className="flex items-center gap-1.5 tabular">
              <span className="text-muted-foreground line-through">₱450</span>
              <ArrowRightIcon className="size-3 text-muted-foreground" />
              <span className="font-medium">₱600</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">New field on Bookings</span>
            <span className="font-medium">Paddle rental</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-[12px] text-muted-foreground">
          <span>Saved as version 14. Undo anytime.</span>
          <span className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground">Apply</span>
        </div>
      </div>
    </Panel>
  );
}
