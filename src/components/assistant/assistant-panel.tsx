"use client";

import {
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUUpLeftIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  MinusCircleIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AttachmentTray, ComposerTools, DropOverlay, MessageFiles } from "@/components/ai/composer-tools";
import { useAttachments } from "@/components/ai/use-attachments";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { type AssistantTurn, type ThreadSummary, useAssistant } from "@/lib/assistant/panel-store";
import type { Navigation, Screen } from "@/lib/assistant/screen";
import { useScreen } from "@/lib/assistant/screen-store";
import { useCurrentUser } from "@/lib/auth/client";
import type { ChangePlan } from "@/lib/engine/changes";
import { formatDateTime } from "@/lib/format";
import { markFresh } from "@/lib/motion/fresh";
import { blueprintOf } from "@/lib/store/workspace-model";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

const EMPTY: AssistantTurn[] = [];
const NO_THREADS: ThreadSummary[] = [];

type Link = { label: string; onGo: () => void };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Plain text with the names of records it's based on turned into links that open them. */
function Linked({ text, links }: { text: string; links: Link[] }) {
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
            className="rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-2 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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

/** "**bold**" in replies, rendered without pulling in a markdown library; record names become links. */
function Rich({ text, links = [] }: { text: string; links?: Link[] }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <strong key={i} className="font-medium">
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

/** The record's own name from a source label ("Booking: Miguel Santos" → "Miguel Santos"). */
const recordName = (nav: Navigation) =>
  nav.recordId ? nav.label.slice(nav.label.indexOf(": ") + 2) : nav.label;

/** What a reply is based on: each one opens the record or page. */
function SourceLinks({ sources, onGo }: { sources: Navigation[]; onGo: (nav: Navigation) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11.5px] text-muted-foreground">Sources</span>
      {sources.map((s) => (
        <button
          key={`${s.path}|${s.recordId ?? ""}`}
          type="button"
          onClick={() => onGo(s)}
          title={`Open ${s.label}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[12px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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

/** While the assistant works: what it has done, what it's doing now, and for how long. */
function Working({ steps, startedAt }: { steps: string[]; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const shown = steps.length ? steps : ["Starting"];
  return (
    <output aria-live="polite" className="flex flex-col gap-1.5 text-[12.5px]">
      {shown.map((s, i) => {
        const current = i === shown.length - 1;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: steps only grow
            key={i}
            className={cn("flex items-center gap-2", current ? "text-foreground" : "text-muted-foreground")}
          >
            {current ? (
              <CircleNotchIcon className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <CheckIcon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{s}</span>
            {current ? (
              <span className="font-mono text-[11px] text-muted-foreground tabular">
                {Math.max(0, Math.round((now - startedAt) / 1000))}s
              </span>
            ) : null}
          </div>
        );
      })}
    </output>
  );
}

/** After a reply: what the assistant did, folded away. */
function ActivityLog({ activity, durationMs }: { activity: string[]; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : undefined;
  return (
    <div className="mb-1.5 text-[12px] text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CaretRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        {seconds ? `Worked for ${seconds}s` : "Worked"} · {activity.length}{" "}
        {activity.length === 1 ? "step" : "steps"}
      </button>
      {open ? (
        <ol className="mt-1 ml-1.5 flex flex-col gap-1 border-l pl-3">
          {activity.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
            <li key={i}>{a}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Where the person is and what's on screen, so "this" and "here" mean something to the assistant. */
function useCurrentScreen(): Screen {
  const ws = useWorkspace();
  const pathname = usePathname();
  const recordId = useScreen((s) => s.recordId);
  const view = useScreen((s) => s.view);
  return useMemo(() => {
    const [first, second] = pathname.slice(ws.basePath.length).split("/").filter(Boolean);
    let base: Screen;
    if (!first) base = { area: "home" };
    else if (first === "ask" || first === "history") base = { area: first };
    else if (first === "settings")
      base = {
        area: "settings",
        settingsTab: second === "team" || second === "publish" ? second : "general",
      };
    else {
      const system = ws.blueprint.systems.find((s) => s.id === first);
      const viewId = second ?? system?.viewIds[0];
      base = { area: "page", systemId: first, ...(viewId ? { viewId } : {}) };
    }
    const shown = view && view.viewId === base.viewId ? view : undefined;
    const open = recordId && ws.records.some((r) => r.id === recordId) ? recordId : shown?.selectedId;
    return {
      ...base,
      ...(open ? { recordId: open } : {}),
      ...(shown?.search ? { search: shown.search } : {}),
      ...(shown?.from && shown.to ? { from: shown.from, to: shown.to } : {}),
      ...(shown?.status ? { status: shown.status } : {}),
    };
  }, [pathname, ws.basePath, ws.blueprint, ws.records, recordId, view]);
}

/** Opening suggestions, built around the page the person is on and the record type the workspace uses most. */
function starters(names: string[], manager: boolean, onPage: boolean) {
  const first = names[0]?.toLowerCase() ?? "records";
  return [
    onPage ? "Summarize what's on this page" : "What needs my attention today?",
    `Give me a summary of my ${first}`,
    ...(manager ? [`Add a notes field to ${first}`, "I also want to manage my clients"] : []),
  ];
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

/** A link under a reply: the page or record the assistant opened or suggests. */
function GoToLink({ nav, onGo }: { nav: Navigation; onGo: () => void }) {
  return (
    <button
      type="button"
      onClick={onGo}
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <ArrowRightIcon className="size-3.5 shrink-0" />
      <span className="truncate">{nav.label}</span>
    </button>
  );
}

function PlanCard({
  plan,
  state,
  onApply,
  onDismiss,
  onUndo,
  onOpenPage,
}: {
  plan: ChangePlan;
  state: AssistantTurn["planState"];
  onApply: () => void;
  onDismiss: () => void;
  onUndo: () => void;
  onOpenPage?: () => void;
}) {
  const created = plan.recordOps?.filter((o) => o.op === "create_record").length ?? 0;
  const updated = plan.recordOps?.filter((o) => o.op === "update_record").length ?? 0;
  const deleted = plan.recordOps?.filter((o) => o.op === "delete_record").length ?? 0;
  const removes =
    deleted > 0 ||
    plan.ops.some((o) => o.op.startsWith("remove_")) ||
    plan.steps.some((s) => s.kind === "remove");
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
              <dd className={cn("text-right", f.label === "Records deleted" && "text-destructive")}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ul className="flex flex-col gap-2 px-3 py-2.5">
        {plan.steps.map((s) => (
          <li key={`${s.label}-${s.detail}`} className="flex gap-2">
            <span
              className={cn("mt-0.5", s.kind === "remove" ? "text-destructive" : "text-muted-foreground")}
            >
              {s.kind === "add" ? (
                <PlusIcon className="size-3.5" />
              ) : s.kind === "remove" ? (
                <MinusCircleIcon className="size-3.5" />
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
        {created || updated || deleted ? (
          <li className="text-[12.5px] text-muted-foreground">
            {[
              created && `Adds ${created} ${created === 1 ? "record" : "records"}`,
              updated && `updates ${updated} ${updated === 1 ? "record" : "records"}`,
              deleted && `deletes ${deleted} ${deleted === 1 ? "record" : "records"}`,
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
            {onOpenPage ? (
              <Button size="sm" variant="ghost" onClick={onOpenPage}>
                <ArrowRightIcon data-icon="inline-start" />
                Open
              </Button>
            ) : null}
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
            <Button size="sm" variant={removes ? "destructive" : "default"} onClick={onApply}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
            <span className="ml-auto text-right text-[11.5px] text-muted-foreground">
              {removes ? "You can undo it afterwards" : "Checked against your workspace"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Past conversations in this workspace; picking one continues it. */
function ThreadList({
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
        <ul className="flex flex-col">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                aria-current={t.id === activeId ? "true" : undefined}
                className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=true]:bg-muted"
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

type Reply =
  | {
      ok: true;
      kind: string;
      reply: string;
      suggestions: string[];
      plan?: ChangePlan;
      navigate?: Navigation;
      sources?: Navigation[];
    }
  | { ok: false; message: string };

/** Reads the assistant's streamed answer: status lines while it works, then the result. */
async function readReply(res: Response, onStatus: (text: string) => void): Promise<Reply | null> {
  if (!res.body || !res.headers.get("content-type")?.includes("ndjson"))
    return (await res.json().catch(() => null)) as Reply | null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Reply | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const message = JSON.parse(line) as { type: "status"; text: string } | ({ type: "result" } & Reply);
      if (message.type === "status") onStatus(message.text);
      else result = message;
    }
  }
  return result;
}

/**
 * The workspace assistant: ask anything about the workspace, or describe a change. Answers come from
 * the workspace's data, with links to what they're based on; changes come back as a plan that's applied
 * only when the person approves it, with undo, and recorded in History. Conversations are kept.
 */
export function AssistantPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const ws = useWorkspace();
  const user = useCurrentUser();
  const screen = useCurrentScreen();
  const router = useRouter();
  const pathname = usePathname();
  const activeId = useAssistant((s) => s.active[ws.id]);
  const turns = useAssistant((s) => (activeId ? s.threads[activeId] : undefined) ?? EMPTY);
  const threads = useAssistant((s) => s.lists[ws.id] ?? NO_THREADS);
  const showHistory = useAssistant((s) => s.showHistory);
  const { push, patch, start, openThread, loadList, setShowHistory } = useAssistant.getState();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const files = useAttachments();
  const voice = useVoiceInput((said) => {
    setInput((v) => (v.trim() ? `${v.trimEnd()} ${said}` : said));
    textarea.current?.focus();
  });
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const manager = canManage(ws.role);
  const editor = canEdit(ws.role);

  useEffect(() => {
    void loadList(ws.id);
  }, [ws.id, loadList]);

  /** Opens a page (and a record on it). On phones the panel covers the page, so it closes to show it. */
  const go = (nav: Navigation) => {
    const href = `${ws.basePath}${nav.path}`;
    if (href !== pathname) router.push(href);
    useScreen.getState().openRecord(nav.recordId ?? null);
    if (window.matchMedia("(max-width: 767px)").matches) onClose();
  };

  const count = turns.length;
  const stepCount = steps.length;
  useEffect(() => {
    if (count || pending || stepCount)
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [count, pending, stepCount]);
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
    const began = Date.now();
    const activity: string[] = [];
    setStartedAt(began);
    setSteps([]);
    const messages = [...history, userTurn]
      .filter((t) => !t.error)
      .slice(-12)
      .map((t) => ({
        role: t.role,
        text: [
          t.text,
          t.plan && `(Plan "${t.plan.title}" — ${t.planState ?? "pending"})`,
          t.navigate && `(${t.navigate.open ? "Opened" : "Linked to"} ${t.navigate.label})`,
        ]
          .filter(Boolean)
          .join("\n"),
        ...(t.attachments?.length ? { attachments: t.attachments } : {}),
      }));
    try {
      // Unsaved edits reach the server first, so the assistant sees what's on screen.
      await new Promise((r) => setTimeout(r, 600));
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, screen, messages }),
      });
      const body = await readReply(res, (status) => {
        activity.push(status);
        setSteps([...activity]);
      });
      const worked = { activity, durationMs: Date.now() - began };
      if (body?.ok) {
        push(ws.id, {
          role: "assistant",
          text: body.reply,
          suggestions: body.suggestions,
          ...worked,
          ...(body.plan ? { plan: body.plan, planState: "pending" as const } : {}),
          ...(body.navigate ? { navigate: body.navigate } : {}),
          ...(body.sources?.length ? { sources: body.sources } : {}),
        });
        if (body.navigate?.open) go(body.navigate);
      } else
        push(ws.id, {
          role: "assistant",
          text: body?.message ?? "Something went wrong. Try again.",
          error: true,
          ...worked,
        });
    } catch {
      push(ws.id, {
        role: "assistant",
        text: "You seem to be offline. Try again when you're connected.",
        error: true,
      });
    } finally {
      setPending(false);
      setSteps([]);
    }
  };

  const apply = (index: number, plan: ChangePlan) => {
    const current = useWorkspaces.getState().workspaces[ws.id];
    // A plan from an older conversation was checked against an older design: ask for it again instead.
    if (current && plan.ops.length && plan.baseVersion && blueprintOf(current).version !== plan.baseVersion) {
      toast.warning("The workspace changed since this plan was made", {
        description: "Ask again and the assistant will plan it against the current design.",
      });
      return;
    }
    const entry = applyChange(ws.id, plan, user?.name);
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
      toast.warning("Undo the newer changes first", {
        description: "Changes are undone newest first. History shows them in order.",
      });
      return;
    }
    patch(ws.id, index, { planState: "undone" });
    toast.success("Change undone");
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
            screen.area === "page",
          )
        : [];

  return (
    <section aria-label="Assistant" className={cn("flex min-h-0 flex-col bg-background", className)}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <span className="mr-1 flex size-6 items-center justify-center rounded-md border">
          <LogoMark className="size-3" />
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">Assistant</span>
        <Button
          size="icon-sm"
          variant={showHistory ? "secondary" : "ghost"}
          aria-label="Conversations"
          aria-pressed={showHistory}
          title="Conversations"
          onClick={() => setShowHistory(!showHistory)}
        >
          <ClockCounterClockwiseIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New conversation"
          title="New conversation"
          disabled={pending}
          onClick={() => start(ws.id)}
        >
          <ChatsCircleIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Close assistant" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ThreadList
            threads={threads}
            activeId={activeId}
            onNew={() => start(ws.id)}
            onOpen={(id) =>
              void openThread(ws.id, id).then((ok) => {
                if (!ok) toast.error("Couldn't open that conversation", { description: "Try again." });
              })
            }
          />
        </div>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {!turns.length ? (
            <div className="flex flex-col gap-2 px-1 pt-2 pb-4">
              <SparkleIcon className="size-5 text-primary" />
              <p className="text-[14px] font-medium">Ask anything about {ws.name}</p>
              <p className="text-[13px] text-muted-foreground">
                {manager
                  ? "Get answers from your data, or ask for any change: add, edit or delete records, pages, fields and cards, write pages, or manage the team. You approve every change, and every change can be undone."
                  : editor
                    ? "Get answers from your data, or ask to add, update or delete records. You approve every change, and every change can be undone."
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
                  {t.activity?.length ? (
                    <ActivityLog activity={t.activity} durationMs={t.durationMs} />
                  ) : null}
                  <p className={cn("whitespace-pre-line", t.error && "text-warning")}>
                    <Rich
                      text={t.text}
                      links={(t.sources ?? [])
                        .filter((s) => s.recordId)
                        .map((s) => ({ label: recordName(s), onGo: () => go(s) }))}
                    />
                  </p>
                  {t.sources?.length ? <SourceLinks sources={t.sources} onGo={go} /> : null}
                  {t.navigate ? (
                    <GoToLink nav={t.navigate} onGo={() => go(t.navigate as Navigation)} />
                  ) : null}
                  {t.plan ? (
                    <PlanCard
                      plan={t.plan}
                      state={t.planState}
                      onApply={() => apply(i, t.plan as ChangePlan)}
                      onDismiss={() => patch(ws.id, i, { planState: "dismissed" })}
                      onUndo={() => undo(i, t.changeId)}
                      onOpenPage={(() => {
                        const page = newPageOf(t.plan);
                        return page ? () => go(page) : undefined;
                      })()}
                    />
                  ) : null}
                </div>
              ),
            )}
            {pending ? <Working steps={steps} startedAt={startedAt} /> : null}
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
      )}

      <form
        className="border-t p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        {...files.dropProps}
      >
        <InputGroup className="relative h-auto">
          <DropOverlay attachments={files} />
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
