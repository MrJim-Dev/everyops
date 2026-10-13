"use client";

import { CheckIcon, NotePencilIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/editor/markdown";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { DocumentView as DocumentViewConfig } from "@/lib/blueprint/types";
import { formatDateTime } from "@/lib/format";
import { canEdit } from "@/lib/store/workspaces";
import { ViewEmpty } from "./view-empty";

const SAVE_DELAY = 600;

/** A free page of markdown: reads like a document, and anyone who can edit can open the editor. */
export function DocumentView({ view }: { view: DocumentViewConfig }) {
  const ws = useWorkspace();
  const saved = ws.docs[view.id];
  const body = saved?.body ?? view.starter ?? "";
  const editable = canEdit(ws.role);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const latest = useRef({ draft, body, save: ws.saveDoc });
  latest.current = { draft, body, save: ws.saveDoc };

  // Save while typing, a moment after the last keystroke.
  useEffect(() => {
    if (!editing || draft === latest.current.body) return;
    const timer = setTimeout(() => latest.current.save(view.id, draft), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draft, editing, view.id]);

  const finish = () => {
    if (latest.current.draft !== latest.current.body) ws.saveDoc(view.id, latest.current.draft);
    setEditing(false);
  };
  const pending = editing && draft !== body;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-5 py-6 md:px-8">
        <div className="flex min-h-8 items-center gap-3 text-[12px] text-muted-foreground">
          <span className="flex-1">
            {editing ? (
              pending ? (
                "Saving…"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CheckIcon className="size-3.5" /> Saved
                </span>
              )
            ) : saved ? (
              `Last edited ${formatDateTime(saved.updatedAt)}`
            ) : null}
          </span>
          {editable && !editing ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(body);
                setEditing(true);
              }}
            >
              <NotePencilIcon data-icon="inline-start" />
              Edit page
            </Button>
          ) : null}
          {editing ? (
            <Button size="sm" onClick={finish}>
              Done
            </Button>
          ) : null}
        </div>
        {editing ? (
          <MarkdownEditor
            label={`${view.name} text`}
            value={draft}
            onChange={setDraft}
            autoFocus
            minHeight={460}
          />
        ) : body.trim() ? (
          <article className="mx-auto w-full max-w-[720px] pb-10">
            <Markdown>{body}</Markdown>
          </article>
        ) : (
          <ViewEmpty
            title="This page is empty"
            description={
              editable
                ? "Write anything here in markdown: notes, policies, how-tos."
                : "Nothing has been written here yet."
            }
            actionLabel={editable ? "Start writing" : undefined}
            onAction={() => {
              setDraft("");
              setEditing(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
