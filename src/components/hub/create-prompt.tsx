"use client";

import { ArrowUpIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useAuthReady, useCurrentUser } from "@/lib/auth/client";
import type { WorkspaceData } from "@/lib/blueprint/types";
import { useHydrated } from "@/lib/store/use-hydrated";
import { useWorkspaces } from "@/lib/store/workspaces";

/** A visitor's prompt, kept across the sign-in round trip so it can continue afterwards. */
const PENDING_KEY = "everyops.pending-prompt";

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

const STARTERS = [
  { label: "Booking", prompt: "I run a pickleball venue in Cebu with 4 courts and need a booking system." },
  { label: "Sales tracker", prompt: "I need to track my bakery's sales, expenses and monthly budget." },
  { label: "Social media", prompt: "I need to plan our café's Instagram and Facebook posts." },
  { label: "HRIS", prompt: "I need to manage employee leave requests and balances." },
  { label: "POS", prompt: "I need a POS for our school canteen with stock tracking." },
];

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

  const create = (text: string) => {
    const slug = createWorkspace({
      name: "New workspace",
      summary: "Setting up",
      data: EMPTY,
      setup: { prompt: text },
    });
    router.push(`/w/${slug}/ask`);
  };

  const start = () => {
    const text = prompt.trim();
    if (!text || !authReady) return;
    if (!user) {
      // Visitors sign in first, then come back here and the setup continues with this prompt.
      try {
        sessionStorage.setItem(PENDING_KEY, text);
      } catch {}
      router.push(`/sign-in?next=${encodeURIComponent("/")}`);
      return;
    }
    create(text);
  };

  // Back from sign-in: put the prompt back, and continue once the account's workspaces have loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: create only uses stable store and router references
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    setPrompt(pending);
    if (!user || !storeReady) return;
    sessionStorage.removeItem(PENDING_KEY);
    create(pending);
  }, [user, storeReady]);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <form
        className="w-full max-w-[680px]"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <InputGroup className="h-auto rounded-xl bg-card has-[textarea:focus-visible]:border-foreground/25">
          <InputGroupTextarea
            aria-label="Describe what your business needs"
            placeholder="I need a system to…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                start();
              }
            }}
            rows={3}
            className="min-h-[96px] px-4 py-3.5 text-[15px]"
          />
          <InputGroupAddon align="block-end" className="justify-between px-3 pb-3">
            <span className="text-[12px] text-muted-foreground">
              EveryOps asks a few questions, then builds it in your workspace.
            </span>
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              aria-label="Start"
              disabled={!prompt.trim()}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setPrompt(s.prompt)}
            className="rounded-full border px-3 py-1 text-[12.5px] text-muted-foreground outline-none transition-[color,border-color,transform] duration-150 hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
