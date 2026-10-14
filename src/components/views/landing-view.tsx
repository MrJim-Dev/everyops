"use client";

import { CheckIcon, NotePencilIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { PublicBlocks } from "@/components/public/public-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Block, LandingView as LandingConfig } from "@/lib/blueprint/types";
import { docKey, resolveBlocks } from "@/lib/public/resolve";
import { canEdit, canManage } from "@/lib/store/workspaces";
import { PublicBar } from "./public-bar";

/** A landing page inside the app: a live preview of the public page, with its text editable in place. */
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PublicBar view={view}>
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
          <div className="mx-auto w-full max-w-[1100px] px-5 py-8">
            {blocks.length ? (
              <PublicBlocks blocks={blocks} slug={ws.id} preview />
            ) : (
              <p className="py-16 text-center text-[13px] text-muted-foreground">
                This page has nothing on it yet. Ask the assistant to add a hero, your rates or your FAQs.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
