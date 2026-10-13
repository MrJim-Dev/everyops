"use client";

import { ArrowUpIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ComposerTools } from "@/components/ai/composer-tools";
import { PENDING_KEY, StarterChips } from "@/components/hub/starters";
import { useCurrentUser } from "@/lib/auth/client";

const EXAMPLES = [
  "I run a pickleball venue in Cebu with 4 courts and need online bookings.",
  "I need a POS for our school canteen that keeps track of stock.",
  "I want to plan our café's Instagram and TikTok posts each week.",
  "I need to approve leave requests for a team of 18.",
];

/** Types the examples into the placeholder, one character at a time. Pauses while in use. */
function useTypedExample(paused: boolean) {
  const [text, setText] = useState(EXAMPLES[0]);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let example = 0;
    let length = EXAMPLES[0].length;
    let deleting = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = EXAMPLES[example];
      length += deleting ? -1 : 1;
      setText(full.slice(0, length));
      let wait = deleting ? 14 : 32;
      if (!deleting && length === full.length) {
        deleting = true;
        wait = 2200;
      } else if (deleting && length === 0) {
        deleting = false;
        example = (example + 1) % EXAMPLES.length;
        wait = 350;
      }
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, 2600);
    return () => clearTimeout(timer);
  }, [paused]);
  return text;
}

/**
 * The landing page's prompt. It can't build without an account, so it keeps the
 * description and hands it to the dashboard after sign-up.
 */
export function HeroPrompt() {
  const router = useRouter();
  const user = useCurrentUser();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const placeholder = useTypedExample(focused || value.length > 0);

  const submit = () => {
    const text = value.trim();
    if (!text) {
      ref.current?.focus();
      return;
    }
    sessionStorage.setItem(PENDING_KEY, text);
    router.push(user ? "/" : "/sign-up?next=/");
  };

  /** Files and voice need an account (they go to Gemini and storage), so keep what's typed and continue there. */
  const continueWithAccount = () => {
    if (value.trim()) sessionStorage.setItem(PENDING_KEY, value.trim());
    router.push(user ? "/" : "/sign-up?next=/");
  };

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <form
        className="w-full max-w-[640px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-foreground/10 bg-card/80 p-2 pl-4 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_12%,transparent),0_20px_60px_-24px_color-mix(in_oklab,var(--primary)_40%,transparent)]">
          <textarea
            ref={ref}
            rows={2}
            value={value}
            aria-label="Describe what your business needs"
            placeholder={focused || value ? "Describe what your business needs…" : placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-[52px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
          />
          <span className="flex h-10 shrink-0 items-center">
            <ComposerTools onAttachClick={continueWithAccount} onVoiceClick={continueWithAccount} />
          </span>
          <button
            type="submit"
            aria-label="Build it"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13.5px] font-medium text-primary-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-glow focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
          >
            <span className="hidden sm:inline">Build it</span>
            <ArrowUpIcon weight="bold" className="size-4" />
          </button>
        </div>
      </form>
      <StarterChips
        onPick={(prompt) => {
          setValue(prompt);
          ref.current?.focus();
        }}
      />
    </div>
  );
}
