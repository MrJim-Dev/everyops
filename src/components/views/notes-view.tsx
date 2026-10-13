"use client";

import { ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/editor/markdown";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { FieldValue } from "@/components/records/field-value";
import { StatusMenu } from "@/components/records/status-menu";
import { Button } from "@/components/ui/button";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { statusField } from "@/lib/blueprint/field-kind";
import { findRecord, getEntity } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, NotesView as NotesViewConfig } from "@/lib/blueprint/types";
import { searchRecords } from "@/lib/engine/query";
import { formatDateTime } from "@/lib/format";
import { useFreshStore } from "@/lib/motion/fresh";
import { canEdit } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { SearchInput } from "./search-input";
import { ViewEmpty } from "./view-empty";

const SAVE_DELAY = 700;
const text = (v: unknown) => (typeof v === "string" ? v : "");
/** First line of the body without markdown symbols, for the list. */
const snippet = (body: string) =>
  body
    .split("\n")
    .map((l) =>
      l
        .replace(/^[#>\-*+\d.\s[\]x]+/, "")
        .replace(/[*_`~]/g, "")
        .trim(),
    )
    .find(Boolean) ?? "";

/** A notebook: notes on the left, the selected note's title and markdown body on the right. */
export function NotesView({ view }: { view: NotesViewConfig }) {
  const ws = useWorkspace();
  const actions = useRecordActions();
  const entity = getEntity(ws.blueprint, view.entityId);
  const fresh = useFreshStore((s) => s.ids);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const editable = canEdit(ws.role);

  const notes = useMemo(() => {
    const own = ws.records.filter((r) => r.entityId === entity.id);
    const found = searchRecords(
      own,
      query,
      (r) => `${text(r.data[view.titleFieldId])} ${text(r.data[view.bodyFieldId])}`,
    );
    return [...found].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [ws.records, entity.id, query, view.titleFieldId, view.bodyFieldId]);

  const current = (selected ? findRecord(ws.records, selected) : undefined) ?? notes[0];

  const create = () => {
    const status = statusField(entity);
    const result = actions.create(entity.id, {
      [view.titleFieldId]: "Untitled",
      [view.bodyFieldId]: "",
      ...(status?.options?.[0] ? { [status.id]: status.options[0].id } : {}),
    });
    if (result.ok) {
      setQuery("");
      setSelected(result.record.id);
      setMobileOpen(true);
    } else toast.error(result.errors[0]?.message ?? `That ${entity.name.toLowerCase()} couldn't be created.`);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "flex w-full min-w-0 flex-col border-r md:w-[300px] md:shrink-0",
          mobileOpen && "hidden md:flex",
        )}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={`Search ${entity.pluralName.toLowerCase()}`}
          />
          {editable ? (
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`New ${entity.name.toLowerCase()}`}
              onClick={create}
            >
              <PlusIcon />
            </Button>
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                aria-current={note.id === current?.id ? "true" : undefined}
                onClick={() => {
                  setSelected(note.id);
                  setMobileOpen(true);
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted aria-[current=true]:bg-muted",
                  fresh[note.id] && "animate-flash",
                )}
              >
                <span className="truncate text-[13.5px] font-medium">
                  {text(note.data[view.titleFieldId]) || "Untitled"}
                </span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {snippet(text(note.data[view.bodyFieldId])) || "No text yet"}
                </span>
                <span className="text-[11.5px] text-muted-foreground/80">
                  {formatDateTime(note.updatedAt)}
                </span>
              </button>
            </li>
          ))}
          {!notes.length ? (
            <li className="px-4 py-6 text-[13px] text-muted-foreground">
              {query ? "No matches." : `No ${entity.pluralName.toLowerCase()} yet.`}
            </li>
          ) : null}
        </ul>
      </aside>
      <section className={cn("min-w-0 flex-1 overflow-y-auto", !mobileOpen && "hidden md:block")}>
        {current ? (
          <NoteEditor
            key={current.id}
            note={current}
            entity={entity}
            view={view}
            editable={editable}
            onBack={() => setMobileOpen(false)}
            onDelete={() => {
              actions.remove(current.id, entity.name);
              setSelected(null);
              setMobileOpen(false);
            }}
          />
        ) : (
          <ViewEmpty
            title={`No ${entity.pluralName.toLowerCase()} yet`}
            description="Write meeting notes, ideas, checklists and anything else worth keeping."
            actionLabel={editable ? `New ${entity.name.toLowerCase()}` : undefined}
            onAction={create}
          />
        )}
      </section>
    </div>
  );
}

function NoteEditor({
  note,
  entity,
  view,
  editable,
  onBack,
  onDelete,
}: {
  note: DataRecord;
  entity: Entity;
  view: NotesViewConfig;
  editable: boolean;
  onBack: () => void;
  onDelete: () => void;
}) {
  const actions = useRecordActions();
  const [title, setTitle] = useState(text(note.data[view.titleFieldId]));
  const [body, setBody] = useState(text(note.data[view.bodyFieldId]));
  const savedTitle = text(note.data[view.titleFieldId]);
  const savedBody = text(note.data[view.bodyFieldId]);
  const dirty = title !== savedTitle || body !== savedBody;
  const latest = useRef({ title, body, dirty, update: actions.update });
  latest.current = { title, body, dirty, update: actions.update };

  // Title and body save together a moment after typing stops, and on leaving the note.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      latest.current.update(note.id, {
        [view.titleFieldId]: title.trim() || "Untitled",
        [view.bodyFieldId]: body,
      });
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, title, body, note.id, view.titleFieldId, view.bodyFieldId]);
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.dirty)
        l.update(note.id, { [view.titleFieldId]: l.title.trim() || "Untitled", [view.bodyFieldId]: l.body });
    },
    [note.id, view.titleFieldId, view.bodyFieldId],
  );

  const meta = (view.metaFieldIds ?? [])
    .map((id) => entity.fields.find((f) => f.id === id))
    .filter((f) => !!f);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3 px-5 py-5 md:px-8">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to the list"
          onClick={onBack}
          className="md:hidden"
        >
          <ArrowLeftIcon />
        </Button>
        <span className="flex flex-1 items-center gap-1">
          {dirty ? (
            "Saving…"
          ) : (
            <>
              <CheckIcon className="size-3.5" /> Saved · {formatDateTime(note.updatedAt)}
            </>
          )}
        </span>
        {editable ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${entity.name.toLowerCase()}`}
            onClick={onDelete}
          >
            <TrashIcon />
          </Button>
        ) : null}
      </div>
      <input
        aria-label={`${entity.name} title`}
        value={title}
        readOnly={!editable}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        className="w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
      />
      {meta.length ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          {meta.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5">
              <span>{f.name}</span>
              {f.type === "status" ? (
                <StatusMenu record={note} field={f} className="text-[12.5px]" />
              ) : (
                <span className="text-foreground">
                  <FieldValue field={f} value={note.data[f.id]} />
                </span>
              )}
            </span>
          ))}
        </div>
      ) : null}
      {editable ? (
        <MarkdownEditor
          label={`${entity.name} text`}
          value={body}
          onChange={setBody}
          placeholder="Write your note in markdown…"
          minHeight={380}
        />
      ) : (
        <div className="rounded-lg border px-5 py-4">
          {body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-[13px] text-muted-foreground">No text yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
