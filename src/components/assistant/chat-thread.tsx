"use client";

import { ArrowClockwiseIcon, ArrowDownIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageFiles } from "@/components/ai/composer-tools";
import { LogoMark } from "@/components/brand/logo";
import type { Navigation } from "@/lib/assistant/screen";
import type { ChangePlan } from "@/lib/engine/changes";
import { cn } from "@/lib/utils";
import { PlanCard } from "./plan-card";
import { ActivityLog, type Link, Linked, recordName, SourceLinks } from "./reply-extras";
import { Thinking } from "./thinking";
import type { AssistantChat } from "./use-assistant-chat";

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
 * A reply's paragraphs and "- " lists, plus bold, without pulling in a markdown library. Blank lines
 * separate paragraphs; a run of "- " or "1. " lines becomes a list.
 */
function Rich({ text, links = [] }: { text: string; links?: Link[] }) {
  const blocks: { id: number; list?: "ul" | "ol"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+/.exec(line);
    const numbered = /^\d+[.)]\s+/.exec(line);
    const kind = bullet ? "ul" : numbered ? "ol" : undefined;
    const content = kind ? line.slice((bullet ?? numbered)?.[0].length) : line;
    const prev = blocks.at(-1);
    if (!line) blocks.push({ id: blocks.length, lines: [] });
    else if (prev && prev.list === kind && (kind || prev.lines.length)) prev.lines.push(content);
    else blocks.push({ id: blocks.length, list: kind, lines: [content] });
  }
  return (
    <div className="flex flex-col gap-2.5">
      {blocks
        .filter((b) => b.lines.length)
        .map((b) =>
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

/** The first page a plan adds, so it can be opened once the plan is applied. */
function newPageOf(plan: ChangePlan): Navigation | undefined {
  for (const op of plan.ops) {
    if (op.op === "add_system") return { path: `/${op.system.id}`, label: op.system.name, open: false };
    if (op.op === "add_view")
      return { path: `/${op.systemId}/${op.view.id}`, label: op.view.name, open: false };
  }
  return undefined;
}

const chip =
  "cursor-pointer rounded-full border px-3 py-1 text-left text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

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
  const [atBottom, setAtBottom] = useState(true);
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
            if (t.role === "user")
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: turns only grow
                <div key={i} className={cn("flex flex-col items-end gap-1.5", fresh && "enter-up")}>
                  {t.ref ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/8 px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {t.ref} section
                    </span>
                  ) : null}
                  <MessageFiles files={t.attachments} />
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
                    <Rich
                      text={t.text}
                      links={(t.sources ?? [])
                        .filter((s) => s.recordId)
                        .map((s) => ({ label: recordName(s), onGo: () => chat.go(s) }))}
                    />
                  </div>
                  {t.sources?.length ? <SourceLinks sources={t.sources} onGo={chat.go} /> : null}
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
                      state={t.planState}
                      onApply={() => chat.apply(i, t.plan as ChangePlan)}
                      onDismiss={() => chat.dismiss(i)}
                      onUndo={() => chat.undo(i, t.changeId)}
                      onOpenPage={(() => {
                        const target = newPageOf(t.plan);
                        return target ? () => chat.go(target) : undefined;
                      })()}
                    />
                  ) : null}
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
    </div>
  );
}
