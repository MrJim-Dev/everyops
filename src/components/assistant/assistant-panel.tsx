"use client";

import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  ArrowUUpLeftIcon,
  CheckIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AttachmentTray, ComposerTools, MessageFiles } from "@/components/ai/composer-tools";
import { useAttachments } from "@/components/ai/use-attachments";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import { LogoMark } from "@/components/brand/logo";
import { TypingIndicator } from "@/components/motion/typing-indicator";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { type AssistantTurn, useAssistant } from "@/lib/assistant/panel-store";
import type { ChangePlan } from "@/lib/engine/changes";
import { markFresh } from "@/lib/motion/fresh";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

const EMPTY: AssistantTurn[] = [];

/** "**bold**" in replies, rendered without pulling in a markdown library. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <strong key={i} className="font-medium">
            {part.slice(2, -2)}
          </strong>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Where the person is, in words, so "this" and "here" mean something to the assistant. */
function usePageLabel() {
  const ws = useWorkspace();
  const pathname = usePathname();
  return useMemo(() => {
    const [systemId, viewId] = pathname.slice(ws.basePath.length).split("/").filter(Boolean);
    if (!systemId) return "Workspace home";
    if (["ask", "history", "settings"].includes(systemId))
      return systemId[0].toUpperCase() + systemId.slice(1);
    const system = ws.blueprint.systems.find((s) => s.id === systemId);
    const view = ws.blueprint.views.find((v) => v.id === (viewId ?? system?.viewIds[0]));
    return (
      [system?.name, view && `${view.name} (${view.type} of ${view.entityId})`].filter(Boolean).join(" > ") ||
      "Workspace"
    );
  }, [pathname, ws.basePath, ws.blueprint]);
}

/** Opening suggestions, built around the record type the workspace uses most. */
function starters(names: string[], manager: boolean) {
  const first = names[0]?.toLowerCase() ?? "records";
  return [
    "What needs my attention today?",
    `Give me a summary of my ${first}`,
    ...(manager ? [`Add a notes field to ${first}`, "I also want to manage my clients"] : []),
  ];
}

function PlanCard({
  plan,
  state,
  onApply,
  onDismiss,
  onUndo,
}: {
  plan: ChangePlan;
  state: AssistantTurn["planState"];
  onApply: () => void;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  const created = plan.recordOps?.filter((o) => o.op === "create_record").length ?? 0;
  const updated = plan.recordOps?.filter((o) => o.op === "update_record").length ?? 0;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-card text-[13px]">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <NotePencilIcon className="size-4 text-primary" />
        <span className="flex-1 font-medium">{plan.title}</span>
      </div>
      {plan.facts.length ? (
        <dl className="grid gap-1.5 border-b px-3 py-2.5">
          {plan.facts.map((f) => (
            <div key={f.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="text-right">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ul className="flex flex-col gap-2 px-3 py-2.5">
        {plan.steps.map((s) => (
          <li key={`${s.label}-${s.detail}`} className="flex gap-2">
            <span className="mt-0.5 text-muted-foreground">
              {s.kind === "add" ? (
                <PlusIcon className="size-3.5" />
              ) : (
                <PencilSimpleIcon className="size-3.5" />
              )}
            </span>
            <span>
              <span className="font-medium">{s.label}</span>
              {s.detail ? (
                <span className="block text-[12.5px] text-muted-foreground">{s.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
        {created || updated ? (
          <li className="text-[12.5px] text-muted-foreground">
            {[
              created && `Adds ${created} ${created === 1 ? "record" : "records"}`,
              updated && `updates ${updated} ${updated === 1 ? "record" : "records"}`,
            ]
              .filter(Boolean)
              .join(", ")}
          </li>
        ) : null}
      </ul>
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {state === "applied" ? (
          <>
            <span className="flex flex-1 items-center gap-1.5 text-primary">
              <CheckIcon className="size-3.5" /> Applied
            </span>
            <Button size="sm" variant="ghost" onClick={onUndo}>
              <ArrowUUpLeftIcon data-icon="inline-start" />
              Undo
            </Button>
          </>
        ) : state === "undone" ? (
          <span className="text-muted-foreground">Undone</span>
        ) : state === "dismissed" ? (
          <span className="text-muted-foreground">Not applied</span>
        ) : (
          <>
            <Button size="sm" onClick={onApply}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
            <span className="ml-auto text-[11.5px] text-muted-foreground">
              Checked against your workspace
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The workspace assistant: ask anything about the workspace, or describe a change. Answers come from
 * the workspace's data; changes come back as a plan that's applied only when the person approves it,
 * with undo, and recorded in History.
 */
export function AssistantPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const ws = useWorkspace();
  const page = usePageLabel();
  const turns = useAssistant((s) => s.threads[ws.id] ?? EMPTY);
  const { push, patch, clear } = useAssistant.getState();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const files = useAttachments();
  const voice = useVoiceInput((said) => {
    setInput((v) => (v.trim() ? `${v.trimEnd()} ${said}` : said));
    textarea.current?.focus();
  });
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const manager = canManage(ws.role);
  const editor = canEdit(ws.role);

  const count = turns.length;
  useEffect(() => {
    if (count || pending)
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [count, pending]);
  useEffect(() => {
    textarea.current?.focus();
  }, []);

  const send = async (text: string, history = turns, withFiles = true) => {
    const clean = text.trim();
    const sent = withFiles ? files.refs : [];
    if ((!clean && !sent.length) || pending || (withFiles && files.uploading)) return;
    const userTurn: AssistantTurn = {
      role: "user",
      text: clean,
      ...(sent.length ? { attachments: sent } : {}),
    };
    push(ws.id, userTurn);
    setInput("");
    if (withFiles) files.clear();
    setPending(true);
    const messages = [...history, userTurn]
      .filter((t) => !t.error)
      .slice(-12)
      .map((t) => ({
        role: t.role,
        text: t.plan ? `${t.text}\n(Plan "${t.plan.title}" — ${t.planState ?? "pending"})` : t.text,
        ...(t.attachments?.length ? { attachments: t.attachments } : {}),
      }));
    try {
      // Unsaved edits reach the server first, so the assistant sees what's on screen.
      await new Promise((r) => setTimeout(r, 600));
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, page, messages }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; kind: string; reply: string; suggestions: string[]; plan?: ChangePlan }
        | { ok: false; message: string }
        | null;
      if (body?.ok)
        push(ws.id, {
          role: "assistant",
          text: body.reply,
          suggestions: body.suggestions,
          ...(body.plan ? { plan: body.plan, planState: "pending" as const } : {}),
        });
      else
        push(ws.id, {
          role: "assistant",
          text: body?.message ?? "Something went wrong. Try again.",
          error: true,
        });
    } catch {
      push(ws.id, {
        role: "assistant",
        text: "You seem to be offline. Try again when you're connected.",
        error: true,
      });
    } finally {
      setPending(false);
    }
  };

  const apply = (index: number, plan: ChangePlan) => {
    const entry = applyChange(ws.id, plan);
    if (!entry) return;
    const touched = [
      ...new Set([
        ...entry.recordChanges.map((c) => c.recordId),
        ...(entry.createdRecordIds ?? []),
        ...(entry.replacedRecords ?? []).map((r) => r.id),
      ]),
    ];
    markFresh(touched);
    patch(ws.id, index, { planState: "applied", changeId: entry.id });
    toast.success(`${plan.title} applied`, {
      description: "Saved to History. You can undo it there or here.",
    });
  };

  const undo = (index: number, changeId?: string) => {
    if (!changeId) return;
    undoChange(ws.id, changeId);
    const entry = useWorkspaces.getState().workspaces[ws.id]?.changes.find((c) => c.id === changeId);
    if (!entry?.undoneAt) {
      toast("This can't be undone here", {
        description: "Newer changes came after it. Use History instead.",
      });
      return;
    }
    patch(ws.id, index, { planState: "undone" });
    toast("Change undone");
  };

  const last = turns.at(-1);
  const suggestions =
    !pending && last?.role === "assistant" && !last.error
      ? (last.suggestions ?? [])
      : !turns.length
        ? starters(
            [...ws.blueprint.entities]
              .sort(
                (a, b) =>
                  ws.records.filter((r) => r.entityId === b.id).length -
                  ws.records.filter((r) => r.entityId === a.id).length,
              )
              .map((e) => e.pluralName),
            manager,
          )
        : [];

  return (
    <section aria-label="Assistant" className={cn("flex min-h-0 flex-col bg-background", className)}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex size-6 items-center justify-center rounded-md border">
          <LogoMark className="size-3" />
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">Assistant</span>
        {turns.length ? (
          <Button size="icon-sm" variant="ghost" aria-label="New conversation" onClick={() => clear(ws.id)}>
            <ArrowClockwiseIcon />
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label="Close assistant" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {!turns.length ? (
          <div className="flex flex-col gap-2 px-1 pt-2 pb-4">
            <SparkleIcon className="size-5 text-primary" />
            <p className="text-[14px] font-medium">Ask anything about {ws.name}</p>
            <p className="text-[13px] text-muted-foreground">
              {manager
                ? "Get answers from your data, or describe a change: new fields, new sections, or whole new systems. You review every change before it's applied."
                : editor
                  ? "Get answers from your data, or ask to add and update records. You review every change first."
                  : "Get answers from your data. Owners and admins can make changes."}
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-4">
          {turns.map((t, i) =>
            t.role === "user" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: turns only grow
              <div key={i} data-role="user" className="flex flex-col items-end gap-1.5">
                <MessageFiles files={t.attachments} />
                {t.text ? (
                  <p className="max-w-[88%] rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-line">
                    {t.text}
                  </p>
                ) : null}
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: turns only grow
              <div key={i} data-role="assistant" className="animate-rise text-[13.5px] leading-relaxed">
                <p className={cn("whitespace-pre-line", t.error && "text-warning")}>
                  <Rich text={t.text} />
                </p>
                {t.plan ? (
                  <PlanCard
                    plan={t.plan}
                    state={t.planState}
                    onApply={() => apply(i, t.plan as ChangePlan)}
                    onDismiss={() => patch(ws.id, i, { planState: "dismissed" })}
                    onUndo={() => undo(i, t.changeId)}
                  />
                ) : null}
              </div>
            ),
          )}
          {pending ? <TypingIndicator label="Looking at your workspace" /> : null}
        </div>
        {suggestions.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s, turns, false)}
                className="rounded-full border px-2.5 py-1 text-left text-[12px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <form
        className="border-t p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        onDragOver={files.onDragOver}
        onDrop={files.onDrop}
      >
        <InputGroup className="h-auto">
          {files.items.length ? (
            <InputGroupAddon align="block-start" className="px-2.5 pt-2.5">
              <AttachmentTray attachments={files} />
            </InputGroupAddon>
          ) : null}
          <InputGroupTextarea
            ref={textarea}
            aria-label="Message the assistant"
            placeholder={manager ? "Ask a question or describe a change…" : "Ask a question…"}
            value={input}
            rows={2}
            className="max-h-36 min-h-14 px-3 py-2.5 text-[13.5px]"
            onChange={(e) => setInput(e.target.value)}
            onPaste={files.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <InputGroupAddon align="block-end" className="justify-between px-2 pb-2">
            <span className="flex items-center gap-2">
              <ComposerTools attachments={files} voice={voice} disabled={pending} />
              {voice.state === "idle" ? (
                <span className="hidden text-[11.5px] text-muted-foreground xl:inline">
                  <Kbd>⌘</Kbd> <Kbd>J</Kbd> to close
                </span>
              ) : null}
            </span>
            <InputGroupButton
              type="submit"
              size="icon-sm"
              aria-label="Send"
              disabled={(!input.trim() && !files.refs.length) || pending || files.uploading}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  );
}

/** Opens the assistant: in the sidebar and as a floating button when the panel is closed. */
export function AssistantToggle({ children, className }: { children?: ReactNode; className?: string }) {
  const toggle = useAssistant((s) => s.toggle);
  return (
    <button type="button" onClick={toggle} className={className}>
      {children}
    </button>
  );
}
