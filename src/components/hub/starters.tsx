"use client";

import {
  CalendarBlankIcon,
  ChartLineUpIcon,
  type Icon,
  MegaphoneSimpleIcon,
  StorefrontIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * A visitor's prompt (from the landing page or the home prompt), kept across sign-in or sign-up.
 * The home prompt picks it up afterwards and starts the setup with it.
 */
export const PENDING_KEY = "everyops.pending-prompt";

export const STARTERS: { label: string; prompt: string; icon: Icon }[] = [
  {
    label: "Booking",
    prompt: "I run a pickleball venue in Cebu with 4 courts and need a booking system.",
    icon: CalendarBlankIcon,
  },
  {
    label: "Sales tracker",
    prompt: "I need to track my bakery's sales, expenses and monthly budget.",
    icon: ChartLineUpIcon,
  },
  {
    label: "Social media",
    prompt: "I need to plan our café's Instagram and Facebook posts.",
    icon: MegaphoneSimpleIcon,
  },
  { label: "HRIS", prompt: "I need to manage employee leave requests and balances.", icon: UsersThreeIcon },
  { label: "POS", prompt: "I need a POS for our school canteen with stock tracking.", icon: StorefrontIcon },
];

/** One-tap examples under a prompt box. Picking one fills the prompt; it never submits. */
export function StarterChips({
  onPick,
  className,
}: {
  onPick: (prompt: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap justify-center gap-2", className)}>
      {STARTERS.map(({ label, prompt, icon: Glyph }) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(prompt)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card/40 px-3 text-[12.5px] text-muted-foreground outline-none transition-[color,border-color,background-color,transform] duration-150 hover:border-foreground/20 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
        >
          <Glyph className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
