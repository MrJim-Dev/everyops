"use client";

import { CaretRightIcon, FileTextIcon, PlusIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ThreadSummary } from "@/lib/assistant/panel-store";
import type { Navigation } from "@/lib/assistant/screen";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Link = { label: string; onGo: () => void };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Plain text with the names of records it's based on turned into links that open them. */
export function Linked({ text, links }: { text: string; links: Link[] }) {
  const usable = links.filter((l) => l.label.length >= 3).sort((a, b) => b.label.length - a.label.length);
  if (!usable.length) return <>{text}</>;
  const pattern = new RegExp(`(${usable.map((l) => escapeRegExp(l.label)).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, i) => {
        const link = usable.find((l) => l.label === part);
        return link ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
            key={i}
            type="button"
            onClick={link.onGo}
            className="cursor-pointer rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-2 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {part}
          </button>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

/** The record's own name from a source label ("Booking: Miguel Santos" → "Miguel Santos"). */
export const recordName = (nav: Navigation) =>
  nav.recordId ? nav.label.slice(nav.label.indexOf(": ") + 2) : nav.label;

/** What a reply is based on: each one opens the record or page. */
export function SourceLinks({ sources, onGo }: { sources: Navigation[]; onGo: (nav: Navigation) => void }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11.5px] text-muted-foreground">Sources</span>
      {sources.map((s) => (
        <button
          key={`${s.path}|${s.recordId ?? ""}`}
          type="button"
          onClick={() => onGo(s)}
          title={`Open ${s.label}`}
          className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[12px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {s.recordId ? (
            <FileTextIcon className="size-3.5 shrink-0" />
          ) : (
            <SquaresFourIcon className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/** After a reply: what the assistant did, folded away. */
export function ActivityLog({ activity, durationMs }: { activity: string[]; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : undefined;
  return (
    <div className="mb-1.5 text-[12px] text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CaretRightIcon className={cn("size-3 transition-transform duration-150", open && "rotate-90")} />
        {seconds ? `Worked for ${seconds}s` : "Worked"} · {activity.length}{" "}
        {activity.length === 1 ? "step" : "steps"}
      </button>
      {open ? (
        <ol className="enter-up mt-1 ml-1.5 flex flex-col gap-1 border-l pl-3">
          {activity.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
            <li key={i}>{a}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Past conversations in this workspace; picking one continues it. */
export function ThreadList({
  threads,
  activeId,
  onOpen,
  onNew,
}: {
  threads: ThreadSummary[];
  activeId?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-[13px] font-medium">Conversations</p>
        <Button size="sm" variant="ghost" onClick={onNew}>
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </div>
      {threads.length ? (
        <ul className="stagger-children flex flex-col">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                aria-current={t.id === activeId ? "true" : undefined}
                className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=true]:bg-muted"
              >
                <span className="truncate text-[13px]">{t.title}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {formatDateTime(t.updatedAt)} · {t.turns} {t.turns === 1 ? "message" : "messages"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[12.5px] text-muted-foreground">
          Your conversations with the assistant are kept here, so you can come back to one later.
        </p>
      )}
    </div>
  );
}
