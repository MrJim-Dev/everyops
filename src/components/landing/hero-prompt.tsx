"use client";

import { ArrowUpIcon, FileTextIcon, XIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ComposerTools } from "@/components/ai/composer-tools";
import { PENDING_KEY, StarterChips } from "@/components/hub/starters";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS } from "@/lib/assistant/attachments";
import { useCurrentUser } from "@/lib/auth/client";
import { keepPendingFiles } from "@/lib/pending-files";

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
 * The landing page's prompt. It can't build without an account, so it keeps the description (and any files the
 * visitor picked) and hands them to the dashboard after sign-up, which uploads the files and starts setup.
 */
export function HeroPrompt() {
  const router = useRouter();
  const user = useCurrentUser();
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [focused, setFocused] = useState(false);
  const placeholder = useTypedExample(focused || value.length > 0);

  const pick = (list: Iterable<File>) => {
    // Copy now: a FileList empties when its input is reset, before the state update runs.
    const added = [...list];
    setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
  };

  const submit = async () => {
    const text = value.trim() || (files.length ? "Set up my workspace from the attached files." : "");
    if (!text) {
      ref.current?.focus();
      return;
    }
    sessionStorage.setItem(PENDING_KEY, text);
    await keepPendingFiles(files);
    router.push(user ? "/" : "/sign-up?next=/");
  };

  /** Voice needs an account (it goes to Gemini), so keep what's typed and picked, and continue there. */
  const continueWithAccount = async () => {
    if (value.trim()) sessionStorage.setItem(PENDING_KEY, value.trim());
    await keepPendingFiles(files);
    router.push(user ? "/" : "/sign-up?next=/");
  };

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <form
        className="w-full max-w-[640px]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          pick(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-foreground/10 bg-card/80 p-2 pl-4 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_12%,transparent),0_20px_60px_-24px_color-mix(in_oklab,var(--primary)_40%,transparent)]">
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
                void submit();
              }
            }}
            className="min-h-[52px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
          />
          <span className="flex h-10 shrink-0 items-center">
            <input
              ref={picker}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                if (e.target.files) pick(e.target.files);
                e.target.value = "";
              }}
            />
            <ComposerTools
              onAttachClick={() => picker.current?.click()}
              onVoiceClick={() => void continueWithAccount()}
            />
          </span>
          <button
            type="submit"
            aria-label="Build it"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13.5px] font-medium text-primary-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-glow focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
          >
            <span className="hidden sm:inline">Build it</span>
            <ArrowUpIcon weight="bold" className="size-4" />
          </button>
          {files.length ? (
            <ul className="order-first flex w-full flex-wrap gap-1.5 pt-1" aria-label="Attached files">
              {files.map((f, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: files can share a name; the list only changes here
                  key={i}
                  className="flex h-8 max-w-[220px] animate-pop items-center gap-1.5 rounded-md border bg-background/60 pr-1 pl-2 text-[12px]"
                >
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <XIcon className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
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
