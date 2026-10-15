"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  BrainIcon,
} from "@phosphor-icons/react";
import NextLink from "next/link";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageFiles } from "@/components/ai/composer-tools";
import { LogoMark } from "@/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { typingMs, useTypewriter } from "@/hooks/use-typewriter";
import { replyBlocks } from "@/lib/assistant/reply-format";
import type { Navigation } from "@/lib/assistant/screen";
import type { Blueprint } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import { cn } from "@/lib/utils";
import { DataEvidenceNote } from "./data-evidence";
import { PlanCard } from "./plan-card";
import { ActivityLog, type Link, Linked, recordName, SourceLinks } from "./reply-extras";
import { RevertDialog } from "./revert-dialog";
import { Thinking } from "./thinking";
import type { AssistantChat, RevertPreview } from "./use-assistant-chat";

/** What the assistant kept from this message, with a way to see or edit the workspace's memory. */
function RememberedNote({ notes }: { notes: string[] }) {
  const ws = useWorkspace();
  return (
    <div className="mt-2 flex max-w-full items-start gap-1.5 rounded-md border border-dashed border-foreground/10 px-2 py-1.5 text-[12px] text-muted-foreground">
      <BrainIcon className="mt-px size-3.5 shrink-0 text-primary" />
      <p className="min-w-0">
        <span className="text-foreground/80">Remembered</span> {notes.join(" · ")}{" "}
        <NextLink href={`${ws.basePath}/settings/assistant`} className="text-primary hover:underline">
          Edit memory
        </NextLink>
      </p>
    </div>
  );
}

/** "**bold**" inside a line of a reply. */
function Inline({ text, links }: { text: string; links: Link[] }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <strong key={i} className="font-medium text-foreground">
            <Linked text={part.slice(2, -2)} links={links} />
          </strong>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <Linked key={i} text={part} links={links} />
        ),
      )}
    </>
  );
}

/**
 * A reply's paragraphs and "- " or "1. " lists (see replyBlocks), plus bold, without pulling in a markdown library.
 */
export function Rich({ text, links = [] }: { text: string; links?: Link[] }) {
  const blocks = replyBlocks(text);
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((b) =>
        b.list ? (
          <ul
            key={b.id}
            className={cn("flex flex-col gap-1 pl-5", b.list === "ol" ? "list-decimal" : "list-disc")}
          >
            {b.lines.map((l, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
              <li key={j} className="pl-0.5 marker:text-muted-foreground">
                <Inline text={l} links={links} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={b.id}>
            {b.lines.map((l, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
              <Fragment key={j}>
                {j ? <br /> : null}
                <Inline text={l} links={links} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

/** A reply that types itself out when it has just arrived (`typing`); older replies show whole. */
export function TypedRich({ text, typing, links }: { text: string; typing: boolean; links?: Link[] }) {
  return <Rich text={useTypewriter(text, typing)} links={links} />;
}

/** The first page or tab a plan adds (or swaps in), so it can be opened once the plan is applied. */
function newPageOf(plan: ChangePlan, bp: Blueprint): Navigation | undefined {
  for (const op of plan.ops) {
    if (op.op === "add_system") return { path: `/${op.system.id}`, label: op.system.name, open: false };
    if (op.op === "add_view")
      return { path: `/${op.systemId}/${op.view.id}`, label: op.view.name, open: false };
    if (op.op === "replace_view") {
      const system = bp.systems.find((s) => s.viewIds.includes(op.view.id) || s.viewIds.includes(op.viewId));
      if (system) return { path: `/${system.id}/${op.view.id}`, label: op.view.name, open: false };
    }
  }
  return undefined;
}

const chip =
  "cursor-pointer rounded-full border px-3 py-1 text-left text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Beside a message of yours: reverts everything the assistant changed from there on. Shown on hover or focus
 * (always on touch screens), so the thread stays quiet until you reach for it.
 */
function RevertButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Revert changes from here"
            onClick={onClick}
            disabled={disabled}
            className="mb-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] duration-150 ease-out group-hover/turn:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-0 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <ArrowCounterClockwiseIcon className="size-3.5" />
          </button>
        }
      />
      <TooltipContent side="left">Revert changes from here</TooltipContent>
    </Tooltip>
  );
}

export function Suggestions({
  items,
  onPick,
  className,
}: {
  items: string[];
  onPick: (s: string) => void;
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((s) => (
        <button key={s} type="button" onClick={() => onPick(s)} className={chip}>
          {s}
        </button>
      ))}
    </div>
  );
}

/**
 * The conversation: your messages on the right, the assistant's replies as plain text with any plan
 * or link under them. Follows new messages while you're at the bottom; scroll up and it stays put,
 * with a button back to the latest.
 */
export function ChatThread({
  chat,
  size,
  empty,
  className,
}: {
  chat: AssistantChat;
  size: "panel" | "page";
  /** Shown above the suggestions before the first message. */
  empty?: ReactNode;
  className?: string;
}) {
  const { turns, pending } = chat;
  const scroller = useRef<HTMLDivElement>(null);
  useFollowBottom(scroller);
  const [atBottom, setAtBottom] = useState(true);
  // The message a revert would start from, and what it would undo (checked when the dialog opens).
  const [reverting, setReverting] = useState<{ index: number; preview: RevertPreview } | null>(null);
  const startRevert = (index: number) => {
    const preview = chat.previewRevert(index);
    if (preview) setReverting({ index, preview });
  };
  // Turns already there when the thread opens don't animate; only new ones do.
  const firstCount = useRef(turns.length);
  if (turns.length < firstCount.current) firstCount.current = turns.length;

  const toBottom = (behavior: ScrollBehavior) =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior });

  // Open at the latest message.
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, []);
  const lastRole = turns.at(-1)?.role;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new turns and the thinking line
  useEffect(() => {
    if (atBottom || lastRole === "user") toBottom("smooth");
  }, [turns.length, !!pending]);

  const page = size === "page";
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-5",
            page ? "max-w-[720px] px-5 pt-8 pb-10" : "px-3 py-4",
          )}
        >
          {!turns.length ? empty : null}
          {turns.map((t, i) => {
            const fresh = i >= firstCount.current;
            const userRow = cn("group/turn flex flex-col items-end gap-1.5", fresh && "enter-up");
            if (t.role === "user")
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: turns only grow
                <div key={i} className={userRow}>
                  {t.ref ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/8 px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {t.ref} section
                    </span>
                  ) : null}
                  <MessageFiles files={t.attachments} />
                  <div className="flex w-full items-end justify-end gap-1">
                    {chat.canRevertFrom(i) ? (
                      <RevertButton onClick={() => startRevert(i)} disabled={!!pending} />
                    ) : null}
                    {t.text ? (
                      <p
                        className={cn(
                          "max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 leading-relaxed whitespace-pre-line",
                          page ? "text-[14.5px]" : "text-[13.5px]",
                        )}
                      >
                        {t.text}
                      </p>
                    ) : null}
                  </div>
                  {t.reverted ? (
                    <span className="enter-up inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                      <ArrowCounterClockwiseIcon className="size-3" />
                      Reverted {t.reverted.count} {t.reverted.count === 1 ? "change" : "changes"}
                    </span>
                  ) : null}
                </div>
              );
            const failed = t.error || t.stopped;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: turns only grow
              <div key={i} className={cn("flex gap-3", fresh && "animate-rise")}>
                {page ? (
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card">
                    <LogoMark className="size-3.5" />
                  </span>
                ) : null}
                <div
                  className={cn("min-w-0 flex-1 leading-relaxed", page ? "text-[14.5px]" : "text-[13.5px]")}
                >
                  {t.activity?.length ? (
                    <ActivityLog activity={t.activity} durationMs={t.durationMs} />
                  ) : null}
                  <div
                    className={cn(
                      "text-foreground/90",
                      t.error && "text-warning",
                      t.stopped && "text-muted-foreground",
                    )}
                  >
                    <TypedRich
                      text={t.text}
                      typing={fresh && !failed}
                      links={(t.sources ?? [])
                        .filter((s) => s.recordId)
                        .map((s) => ({ label: recordName(s), onGo: () => chat.go(s) }))}
                    />
                  </div>
                  {/* Links, the plan card and buttons arrive once the reply has finished typing. */}
                  <div
                    className={cn(fresh && !failed && "animate-rise")}
                    style={fresh && !failed ? { animationDelay: `${typingMs(t.text)}ms` } : undefined}
                  >
                    {t.evidence ? <DataEvidenceNote evidence={t.evidence} /> : null}
                    {t.sources?.length ? <SourceLinks sources={t.sources} onGo={chat.go} /> : null}
                    {t.remembered?.length ? <RememberedNote notes={t.remembered} /> : null}
                    {failed && i === turns.length - 1 && !pending ? (
                      <button
                        type="button"
                        onClick={chat.retry}
                        className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <ArrowClockwiseIcon className="size-3.5" />
                        {t.stopped ? "Send again" : "Try again"}
                      </button>
                    ) : null}
                    {t.navigate ? (
                      <button
                        type="button"
                        onClick={() => chat.go(t.navigate as Navigation)}
                        className="mt-2 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <ArrowRightIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{t.navigate.label}</span>
                      </button>
                    ) : null}
                    {t.plan ? (
                      <PlanCard
                        plan={t.plan}
                        state={chat.planStateOf(t)}
                        auto={t.autoApplied}
                        onApply={() => chat.apply(i, t.plan as ChangePlan)}
                        onDismiss={() => chat.dismiss(i)}
                        onUndo={() => chat.undo(i, t.changeId)}
                        onOpenPage={(() => {
                          const target = newPageOf(t.plan, chat.ws.blueprint);
                          return target ? () => chat.go(target) : undefined;
                        })()}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {pending ? (
            // No key on the phase: the mark keeps drawing smoothly while only the label changes.
            <Thinking
              since={pending.startedAt}
              label={
                pending.steps.at(-1) ?? (pending.phase === "saving" ? "Reading your workspace" : "Thinking")
              }
              slowLabel={pending.steps.at(-1) ?? "Still thinking"}
              avatar={page ? "square" : undefined}
            />
          ) : null}
          <Suggestions
            items={chat.suggestions}
            onPick={(s) => chat.send(s)}
            className={cn(turns.length && page && "pl-10")}
          />
        </div>
      </div>
      {!atBottom ? (
        <button
          type="button"
          aria-label="Jump to latest"
          onClick={() => toBottom("smooth")}
          className="enter-up absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border bg-popover text-muted-foreground shadow-lg outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      ) : null}
      <RevertDialog
        preview={reverting?.preview ?? null}
        message={reverting ? (turns[reverting.index]?.text ?? "") : ""}
        onClose={() => setReverting(null)}
        onConfirm={() => {
          if (reverting) chat.revertFrom(reverting.index);
          setReverting(null);
        }}
        onOpenHistory={() => {
          setReverting(null);
          chat.go({ path: "/history", label: "History", open: true });
        }}
      />
    </div>
  );
}
