"use client";

import { CheckIcon, CursorClickIcon, MagicWandIcon, NotePencilIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { blockLabel, PublicBlocks } from "@/components/public/public-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import { useScreen } from "@/lib/assistant/screen-store";
import type { Block, LandingView as LandingConfig } from "@/lib/blueprint/types";
import { docKey, type ResolvedBlock, resolveBlocks } from "@/lib/public/resolve";
import { copyFromBlocks, standardBlocks } from "@/lib/public/site-template";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";
import { PublicBar } from "./public-bar";

/**
 * A landing page inside the app: a live preview of the public page. Owners and admins click any section to edit it
 * with the assistant (it opens beside the preview with that section attached); "Edit text" edits words by hand.
 */
export function LandingView({ view }: { view: LandingConfig }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const blocks = useMemo(
    () => resolveBlocks(ws.blueprint, ws.records, ws.docs, ws.id, view),
    [ws.blueprint, ws.records, ws.docs, ws.id, view],
  );
  // Custom HTML is code on the public page: only owners and admins change it (the server enforces this too).
  const editable = view.blocks.filter(
    (b) => b.type === "hero" || b.type === "text" || (b.type === "html" && canManage(ws.role)),
  );
  const manager = ws.mode === "live" && canManage(ws.role);
  const applyChange = useWorkspaces((s) => s.applyChange);
  const picked = useScreen((s) => (s.block?.viewId === view.id ? s.block.blockId : undefined));
  const changed = useChangedBlocks(blocks);

  // Leaving the page drops the selection, so the assistant doesn't edit a page that isn't on screen.
  useEffect(
    () => () => {
      if (useScreen.getState().block?.viewId === view.id) useScreen.getState().selectBlock(null);
    },
    [view.id],
  );
  // Escape lets go of the selected section.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement))
        useScreen.getState().selectBlock(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  const select = (b: ResolvedBlock) => {
    const screen = useScreen.getState();
    if (screen.block?.viewId === view.id && screen.block.blockId === b.id) {
      screen.selectBlock(null);
      return;
    }
    screen.selectBlock({
      viewId: view.id,
      blockId: b.id,
      label: blockLabel(b),
      kind: b.type === "records" && b.layout === "faq" ? "faq" : b.type,
    });
    useAssistant.getState().setOpen(true);
  };

  const useStandard = () => {
    const entry = applyChange(ws.id, {
      request: `Use the standard layout for ${view.name}`,
      title: "Use the standard site layout",
      facts: [],
      steps: [
        {
          kind: "change",
          label: view.name,
          detail: "Hero, highlights, offering, steps, payments, FAQ, contact",
        },
      ],
      ops: [
        {
          op: "replace_blocks",
          viewId: view.id,
          blocks: [
            ...standardBlocks(ws.blueprint, ws.name, copyFromBlocks(view.blocks)),
            ...view.blocks.filter((b) => b.type === "html"),
          ],
          layout: "standard",
        },
      ],
    });
    if (entry) toast.success("Switched to the standard layout", { description: "Undo it from History." });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PublicBar view={view}>
        {manager && !editing && blocks.length ? (
          <span className="mr-1 hidden items-center gap-1.5 text-muted-foreground lg:flex">
            <CursorClickIcon className="size-3.5 text-primary" />
            Click a section to edit it with AI
          </span>
        ) : null}
        {manager && view.layout !== "standard" ? (
          <Button size="sm" variant="outline" onClick={useStandard}>
            <MagicWandIcon data-icon="inline-start" />
            Use standard layout
          </Button>
        ) : null}
        {canEdit(ws.role) && editable.length ? (
          <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => setEditing((e) => !e)}>
            {editing ? (
              <>
                <CheckIcon data-icon="inline-start" /> Done
              </>
            ) : (
              <>
                <NotePencilIcon data-icon="inline-start" /> Edit text
              </>
            )}
          </Button>
        ) : null}
      </PublicBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-5 py-6">
            {editable.map((b) => (
              <BlockEditor key={b.id} viewId={view.id} block={b} />
            ))}
            <p className="text-[12.5px] text-muted-foreground">
              Lists, forms and new sections come from your data. Ask the assistant to add or change them.
            </p>
          </div>
        ) : (
          <div className="min-h-full bg-shell">
            <div className="mx-auto w-full max-w-[1120px] px-6 py-10 md:px-8">
              {blocks.length ? (
                <PublicBlocks
                  blocks={blocks}
                  slug={ws.id}
                  preview
                  selection={
                    manager ? { selectedId: picked, changedIds: changed, onSelect: select } : undefined
                  }
                />
              ) : (
                <p className="py-16 text-center text-[13px] text-muted-foreground">
                  This page has nothing on it yet. Ask the assistant to add a hero, your rates or your FAQs.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sections whose content changed since the last render (an applied plan), so they can flash once. */
function useChangedBlocks(blocks: ResolvedBlock[]): Set<string> {
  const last = useRef<Map<string, string> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const now = new Map(blocks.map((b) => [b.id, JSON.stringify(b)]));
    const before = last.current;
    last.current = now;
    if (!before) return;
    const ids = [...now].filter(([id, json]) => before.has(id) && before.get(id) !== json).map(([id]) => id);
    if (!ids.length) return;
    setChanged(new Set(ids));
    const t = setTimeout(() => setChanged(new Set()), 1200);
    return () => clearTimeout(t);
  }, [blocks]);
  return changed;
}

const SAVE_DELAY = 600;

function BlockEditor({ viewId, block }: { viewId: string; block: Block }) {
  const ws = useWorkspace();
  const key = docKey(viewId, block.id);
  const saved = ws.docs[key]?.body;
  const initial =
    block.type === "hero"
      ? JSON.stringify({
          heading: block.heading,
          subheading: block.subheading ?? "",
          ctaLabel: block.ctaLabel ?? "",
          ...safeJson(saved),
        })
      : block.type === "text"
        ? (saved ?? block.markdown)
        : block.type === "html"
          ? (saved ?? block.html)
          : "";
  const [draft, setDraft] = useState(initial);
  const save = useRef(ws.saveDoc);
  save.current = ws.saveDoc;
  useEffect(() => {
    if (draft === initial) return;
    const t = setTimeout(() => save.current(key, draft), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, initial, key]);

  if (block.type === "hero") {
    const hero = safeJson(draft) as { heading?: string; subheading?: string; ctaLabel?: string };
    const set = (k: string, v: string) => setDraft(JSON.stringify({ ...hero, [k]: v }));
    return (
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="text-[13px] font-semibold">Hero</h3>
        <Input
          aria-label="Heading"
          value={hero.heading ?? ""}
          onChange={(e) => set("heading", e.target.value)}
        />
        <Textarea
          aria-label="Subheading"
          rows={2}
          value={hero.subheading ?? ""}
          onChange={(e) => set("subheading", e.target.value)}
        />
        {block.ctaViewId ? (
          <Input
            aria-label="Button label"
            value={hero.ctaLabel ?? ""}
            onChange={(e) => set("ctaLabel", e.target.value)}
          />
        ) : null}
      </section>
    );
  }
  if (block.type === "html")
    return (
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="text-[13px] font-semibold">Custom HTML</h3>
        <Textarea
          aria-label="HTML"
          rows={10}
          className="font-mono text-[12.5px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="text-[12px] text-muted-foreground">
          Runs in a sandbox on the public page, apart from the rest of the site.
        </p>
      </section>
    );
  return <MarkdownEditor label="Section text" value={draft} onChange={setDraft} minHeight={220} />;
}

function safeJson(text: string | undefined): Record<string, string> {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
