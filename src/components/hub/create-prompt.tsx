"use client";

import { ArrowUpIcon, SparkleIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AttachmentTray, ComposerTools, DropOverlay } from "@/components/ai/composer-tools";
import { useAttachments } from "@/components/ai/use-attachments";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import type { AttachmentRef } from "@/lib/assistant/attachments";
import { useAuthReady, useCurrentUser } from "@/lib/auth/client";
import type { WorkspaceData } from "@/lib/blueprint/types";
import { takePendingFiles } from "@/lib/pending-files";
import { useHydrated } from "@/lib/store/use-hydrated";
import { idFromPrompt } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";
import { PENDING_KEY, StarterChips } from "./starters";

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

/** The dashboard prompt's textarea; other parts of the page focus it to start a workspace. */
export const PROMPT_ID = "create-prompt";

const EMPTY: WorkspaceData = {
  blueprint: {
    version: 1,
    workspaceName: "New workspace",
    systems: [],
    entities: [],
    views: [],
    widgets: [],
    rules: [],
  },
  records: [],
};

/** The front door: describe the business, and Ask EveryOps takes it from there. */
export function CreatePrompt() {
  const router = useRouter();
  const createWorkspace = useWorkspaces((s) => s.createWorkspace);
  const authReady = useAuthReady();
  const user = useCurrentUser();
  // The signed-in account's workspaces have loaded (not the signed-out state from before sign-in).
  const loadedOwner = useWorkspaces((s) => s.owner);
  const storeReady = useHydrated() && !!user && loadedOwner === user.id;
  const [prompt, setPrompt] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const files = useAttachments();
  const voice = useVoiceInput((said) => {
    setPrompt((v) => (v.trim() ? `${v.trimEnd()} ${said}` : said));
    ref.current?.focus();
  });

  const create = (text: string, attachments: AttachmentRef[] = []) => {
    const slug = createWorkspace({
      slug: idFromPrompt(text),
      name: "New workspace",
      summary: "Setting up",
      data: EMPTY,
      setup: { prompt: text, ...(attachments.length ? { attachments } : {}) },
    });
    router.push(`/w/${slug}/ask`);
  };

  /** Visitors sign in first, then come back here and the setup continues with this prompt. */
  const signInFirst = () => {
    try {
      if (prompt.trim()) sessionStorage.setItem(PENDING_KEY, prompt.trim());
    } catch {}
    router.push(`/sign-in?next=${encodeURIComponent("/")}`);
  };

  const start = () => {
    const text = prompt.trim() || (files.refs.length ? "Set up my workspace from the attached files." : "");
    if (!text || !authReady || files.uploading) return;
    if (!user) {
      signInFirst();
      return;
    }
    create(text, files.refs);
  };

  // Back from sign-in: put the prompt back, and continue once the account's workspaces have loaded. Files picked
  // on the landing page are uploaded first; setup starts when they're in (any that fail are reported and skipped).
  const [resume, setResume] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: create only uses stable store and router references
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    setPrompt(pending);
    if (!user || !storeReady) return;
    sessionStorage.removeItem(PENDING_KEY);
    void takePendingFiles().then((kept) => {
      if (!kept.length) return create(pending);
      files.add(kept);
      setResume(pending);
    });
  }, [user, storeReady]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: create only uses stable store and router references
  useEffect(() => {
    if (resume === null || files.uploading) return;
    setResume(null);
    create(resume, files.refs);
  }, [resume, files.uploading]);

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <form
        className="w-full max-w-[720px]"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
        {...(user ? files.dropProps : {})}
      >
        <div className="relative rounded-2xl border border-foreground/10 bg-card/80 text-left shadow-[0_24px_70px_-36px_rgba(0,0,0,0.9)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_12%,transparent),0_24px_70px_-30px_color-mix(in_oklab,var(--primary)_40%,transparent)]">
          <DropOverlay attachments={files} />
          <AttachmentTray attachments={files} className="px-3 pt-3" />
          <textarea
            ref={ref}
            id={PROMPT_ID}
            aria-label="Describe what your business needs"
            placeholder="I need a system to…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={user ? files.onPaste : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                start();
              }
            }}
            rows={3}
            className="block min-h-[104px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-3 pl-2">
            <span className="flex min-w-0 items-center gap-2">
              <ComposerTools
                attachments={files}
                voice={voice}
                onAttachClick={user ? undefined : signInFirst}
                onVoiceClick={user ? undefined : signInFirst}
              />
              {voice.state === "idle" ? (
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                  <SparkleIcon weight="fill" className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate">EveryOps asks a few questions, then builds it</span>
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="hidden text-[11.5px] text-muted-foreground sm:inline">
                <kbd className="rounded border bg-background px-1 py-px font-sans text-[11px]">Enter</kbd> to
                send
              </span>
              <button
                type="submit"
                aria-label="Build workspace"
                disabled={(!prompt.trim() && !files.refs.length) || files.uploading}
                className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-glow focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97] disabled:bg-secondary disabled:text-muted-foreground"
              >
                <ArrowUpIcon weight="bold" className="size-4" />
              </button>
            </span>
          </div>
        </div>
      </form>
      <StarterChips
        onPick={(text) => {
          setPrompt(text);
          ref.current?.focus();
        }}
      />
    </div>
  );
}
