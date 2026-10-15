"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAttachments } from "@/components/ai/use-attachments";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { AttachmentRef } from "@/lib/assistant/attachments";
import { type AssistantTurn, type ThreadSummary, useAssistant } from "@/lib/assistant/panel-store";
import type { Navigation, Screen } from "@/lib/assistant/screen";
import { type BlockRef, useScreen } from "@/lib/assistant/screen-store";
import { useCurrentUser } from "@/lib/auth/client";
import type { ChangePlan } from "@/lib/engine/changes";
import { markFresh } from "@/lib/motion/fresh";
import { docKey } from "@/lib/public/resolve";
import { revertChanges } from "@/lib/store/apply-plan";
import { blueprintOf, type ChangeEntry } from "@/lib/store/workspace-model";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";

const EMPTY: AssistantTurn[] = [];
const NO_THREADS: ThreadSummary[] = [];
const NO_CHANGES: ChangeEntry[] = [];
/** One request per workspace can be stopped; kept outside React so the panel and the page share it. */
const inFlight = new Map<string, AbortController>();

/** What reverting from a message would do: the changes it undoes (newest first), or why it can't. */
export type RevertPreview =
  | { kind: "ready"; changes: ChangeEntry[] }
  /** Newer changes made outside this conversation came after; they'd be lost, so History goes first. */
  | { kind: "blocked"; blocking: ChangeEntry[] }
  /** Staff can undo data changes, not the design or the team. */
  | { kind: "not_allowed"; changes: ChangeEntry[] };

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

/** Where the person is and what's on screen, so "this" and "here" mean something to the assistant. */
export function useCurrentScreen(): Screen {
  const ws = useWorkspace();
  const pathname = usePathname();
  const recordId = useScreen((s) => s.recordId);
  const view = useScreen((s) => s.view);
  const block = useScreen((s) => s.block);
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
      ...(block ? { block: { viewId: block.viewId, blockId: block.blockId } } : {}),
    };
  }, [pathname, ws.basePath, ws.blueprint, ws.records, recordId, view, block]);
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

/**
 * The workspace assistant's conversation: sending, stopping and retrying requests, and applying or
 * undoing the plans that come back. The side panel and the Ask EveryOps page both use it, on one thread.
 */
export function useAssistantChat({ onLeave }: { onLeave?: () => void } = {}) {
  const ws = useWorkspace();
  const screen = useCurrentScreen();
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const activeId = useAssistant((s) => s.active[ws.id]);
  const turns = useAssistant((s) => (activeId ? s.threads[activeId] : undefined) ?? EMPTY);
  const threads = useAssistant((s) => s.lists[ws.id] ?? NO_THREADS);
  const showHistory = useAssistant((s) => s.showHistory);
  const pending = useAssistant((s) => s.pending[ws.id]);
  const block = useScreen((s) => s.block);
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const history = useWorkspaces((s) => s.workspaces[ws.id]?.changes ?? NO_CHANGES);
  /**
   * What happened to a turn's plan, with History as the source of truth: a plan applied here and later undone (or
   * redone) in History shows that, instead of what the conversation remembered.
   */
  const planStateOf = (t: AssistantTurn): AssistantTurn["planState"] => {
    if (!t.changeId || (t.planState !== "applied" && t.planState !== "undone")) return t.planState;
    const entry = history.find((c) => c.id === t.changeId);
    if (!entry) return t.planState;
    return entry.undoneAt ? "undone" : "applied";
  };
  const [input, setInput] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  // A request another screen started (Edit layout's "Describe a new part") lands in the composer, ready to finish.
  const draft = useAssistant((s) => s.draft);
  const setDraft = useAssistant((s) => s.setDraft);
  useEffect(() => {
    if (draft === null) return;
    setInput(draft);
    setDraft(null);
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [draft, setDraft]);
  const files = useAttachments();
  const voice = useVoiceInput((said) => {
    setInput((v) => (v.trim() ? `${v.trimEnd()} ${said}` : said));
    textarea.current?.focus();
  });
  const manager = canManage(ws.role);
  const editor = canEdit(ws.role);
  useEffect(() => {
    void useAssistant.getState().loadList(ws.id);
  }, [ws.id]);
  // Picking a section on the website puts the cursor in the message box, ready to describe the change.
  const picked = block ? `${block.viewId}:${block.blockId}` : "";
  useEffect(() => {
    if (picked) requestAnimationFrame(() => textarea.current?.focus());
  }, [picked]);

  /** Opens a page (and a record on it). */
  const go = useCallback(
    (nav: Navigation) => {
      const href = `${ws.basePath}${nav.path}`;
      if (href !== pathname) router.push(href);
      useScreen.getState().openRecord(nav.recordId ?? null);
      onLeave?.();
    },
    [ws.basePath, pathname, router, onLeave],
  );

  const ask = async (
    text: string,
    history: AssistantTurn[],
    attachments: AttachmentRef[],
    ref: BlockRef | null = block,
  ) => {
    const { push, setPending } = useAssistant.getState();
    const userTurn: AssistantTurn = {
      role: "user",
      text,
      ...(attachments.length ? { attachments } : {}),
      ...(ref ? { ref: ref.label } : {}),
    };
    push(ws.id, userTurn);
    const controller = new AbortController();
    inFlight.set(ws.id, controller);
    const began = Date.now();
    const activity: string[] = [];
    setPending(ws.id, { startedAt: began, phase: "saving", steps: [] });
    const messages = [...history, userTurn]
      .filter((t) => !t.error && !t.stopped)
      .slice(-12)
      .map((t) => ({
        role: t.role,
        text: [
          t.ref && `(About the ${t.ref} section I clicked)`,
          t.text,
          t.plan && `(Plan "${t.plan.title}" — ${planStateOf(t) ?? "pending"})`,
          t.navigate && `(${t.navigate.open ? "Opened" : "Linked to"} ${t.navigate.label})`,
        ]
          .filter(Boolean)
          .join("\n"),
        ...(t.attachments?.length ? { attachments: t.attachments } : {}),
      }));
    try {
      // Unsaved edits reach the server first, so the assistant sees what's on screen.
      await new Promise((r) => setTimeout(r, 600));
      if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
      setPending(ws.id, { startedAt: began, phase: "asking", steps: [] });
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, screen, messages }),
        signal: controller.signal,
      });
      const body = await readReply(res, (status) => {
        activity.push(status);
        setPending(ws.id, { startedAt: began, phase: "asking", steps: [...activity] });
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
    } catch (e) {
      const stopped = e instanceof DOMException && e.name === "AbortError";
      push(
        ws.id,
        stopped
          ? { role: "assistant", text: "Stopped.", stopped: true }
          : {
              role: "assistant",
              text: "You seem to be offline. Try again when you're connected.",
              error: true,
            },
      );
    } finally {
      if (inFlight.get(ws.id) === controller) inFlight.delete(ws.id);
      setPending(ws.id, undefined);
      textarea.current?.focus();
    }
  };

  /** Sends what's typed (and attached), or a suggestion when `text` is given. */
  const send = (text?: string) => {
    const fromBox = text === undefined;
    const clean = (fromBox ? input : text).trim();
    const sent = fromBox ? files.refs : [];
    if ((!clean && !sent.length) || pending || (fromBox && files.uploading)) return;
    if (fromBox) {
      setInput("");
      files.clear();
    }
    void ask(clean, turns, sent);
  };

  const stop = () => inFlight.get(ws.id)?.abort();

  /** Sends the last question again after an error or a stop. */
  const retry = () => {
    const at = turns.findLastIndex((t) => t.role === "user");
    if (at < 0 || pending) return;
    const question = turns[at];
    useAssistant.getState().truncate(ws.id, at);
    void ask(question.text, turns.slice(0, at), question.attachments ?? []);
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
    // Words the team typed over a section by hand would hide the assistant's rewrite; the rewrite wins.
    for (const op of plan.ops)
      if (op.op === "update_block" && ws.docs[docKey(op.viewId, op.blockId)]?.body)
        ws.saveDoc(docKey(op.viewId, op.blockId), "");
    markFresh([
      ...new Set([
        ...entry.recordChanges.map((c) => c.recordId),
        ...(entry.createdRecordIds ?? []),
        ...(entry.replacedRecords ?? []).map((r) => r.id),
      ]),
    ]);
    useAssistant.getState().patch(ws.id, index, { planState: "applied", changeId: entry.id });
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
    useAssistant.getState().patch(ws.id, index, { planState: "undone" });
    toast.success("Change undone");
  };

  /** The changes still in effect that this conversation applied from the message at `index` on. */
  const liveFrom = (index: number) => {
    const ids = new Set(
      turns.slice(index).flatMap((t) => (planStateOf(t) === "applied" && t.changeId ? [t.changeId] : [])),
    );
    return ids.size ? history.filter((c) => ids.has(c.id) && !c.undoneAt) : NO_CHANGES;
  };

  /** What reverting from a message would undo, checked on a copy first; null when there's nothing to revert. */
  const previewRevert = (index: number): RevertPreview | null => {
    const live = liveFrom(index);
    const current = useWorkspaces.getState().workspaces[ws.id];
    if (!live.length || !current) return null;
    if (!manager && live.some((c) => c.fromVersion !== c.toVersion || c.teamBefore))
      return { kind: "not_allowed", changes: live };
    const dry = revertChanges(
      current,
      live.map((c) => c.id),
    );
    if (dry.ok) return { kind: "ready", changes: dry.undone };
    return dry.blocking ? { kind: "blocked", blocking: dry.blocking } : null;
  };

  /** Undoes every change this conversation made from the message at `index` on, in one step. */
  const revertFrom = (index: number): boolean => {
    const live = liveFrom(index);
    if (!live.length || pending) return false;
    const result = useWorkspaces.getState().revertChanges(
      ws.id,
      live.map((c) => c.id),
    );
    if (!result.ok) {
      toast.error("Couldn't revert these changes", {
        description: result.blocking?.length
          ? "A newer change came after them. Undo it in History first."
          : "Nothing was changed. Try again, or undo them one at a time in History.",
      });
      return false;
    }
    // Plans undone here or earlier in History both show as undone in the conversation.
    const after = useWorkspaces.getState().workspaces[ws.id]?.changes ?? NO_CHANGES;
    const undone = new Set(after.filter((c) => c.undoneAt).map((c) => c.id));
    const { patch } = useAssistant.getState();
    turns.forEach((t, i) => {
      if (i >= index && t.changeId && undone.has(t.changeId) && t.planState !== "undone")
        patch(ws.id, i, { planState: "undone" });
    });
    const count = result.undone.length;
    patch(ws.id, index, { reverted: { count, at: new Date().toISOString() } });
    toast.success(`Reverted ${count} ${count === 1 ? "change" : "changes"}`, {
      description: "Your workspace is back to how it was before this message.",
    });
    return true;
  };

  const dismiss = (index: number) => useAssistant.getState().patch(ws.id, index, { planState: "dismissed" });
  /** A fresh conversation; the current one stays in the list. */
  const clear = () => {
    stop();
    useAssistant.getState().start(ws.id);
  };
  const openThread = (id: string) =>
    void useAssistant
      .getState()
      .openThread(ws.id, id)
      .then((ok) => {
        if (!ok) toast.error("Couldn't open that conversation", { description: "Try again." });
      });

  const last = turns.at(-1);
  const suggestions =
    !pending && last?.role === "assistant" && !last.error && !last.stopped
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

  return {
    ws,
    turns,
    pending,
    activeId,
    threads,
    showHistory,
    setShowHistory: (show: boolean) => useAssistant.getState().setShowHistory(show),
    openThread,
    /** The website section attached to the next message. */
    block,
    clearBlock: () => useScreen.getState().selectBlock(null),
    input,
    setInput,
    textarea,
    files,
    voice,
    manager,
    editor,
    suggestions,
    send,
    stop,
    retry,
    apply,
    undo,
    /** A plan's state as History has it now (undone or redone there shows here too). */
    planStateOf,
    /** Whether the message at an index has changes after it that can be reverted. */
    canRevertFrom: (index: number) => editor && liveFrom(index).length > 0,
    previewRevert,
    revertFrom,
    dismiss,
    clear,
    go,
  };
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
