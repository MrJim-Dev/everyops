"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { StatusBadge } from "@/components/records/status-badge";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, KanbanView as KanbanConfig } from "@/lib/blueprint/types";
import { recordContext } from "@/lib/engine/context";
import { run, truthy } from "@/lib/engine/expr";
import { applyFilter } from "@/lib/engine/query";
import { useFreshStore } from "@/lib/motion/fresh";
import { todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";

export function KanbanView({ view }: { view: KanbanConfig }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord, openCreate } = useRecordPanels();
  const actions = useRecordActions();
  const entity = getEntity(blueprint, view.entityId);
  const status = getField(entity, view.statusFieldId);
  const longText = entity.fields.find((f) => f.type === "long_text");
  const fresh = useFreshStore((s) => s.ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // A lane is shown when the view's filter would allow records in that stage.
  const lanes = useMemo(
    () =>
      (status.options ?? []).filter((o) =>
        view.filter
          ? truthy(run(view.filter, recordContext(blueprint, entity, { [status.id]: o.id }, records)))
          : true,
      ),
    [status, view.filter, blueprint, entity, records],
  );
  const rows = useMemo(
    () => applyFilter(blueprint, entity, records, view.filter),
    [blueprint, entity, records, view.filter],
  );
  const hidden = (status.options ?? []).filter((o) => !lanes.includes(o));

  const drop = (laneId: string) => {
    if (dragging) actions.update(dragging, { [status.id]: laneId });
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hidden.length ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-5 text-[12px] text-muted-foreground">
          {hidden.map((o) => (
            <span key={o.id}>
              {records.filter((r) => r.entityId === entity.id && r.data[status.id] === o.id).length}{" "}
              {o.label.toLowerCase()} hidden from the board
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-5 py-4">
        {lanes.map((lane) => {
          const cards = rows.filter((r) => r.data[status.id] === lane.id);
          return (
            <section
              key={lane.id}
              aria-label={lane.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(lane.id);
              }}
              onDragLeave={() => setOver((o) => (o === lane.id ? null : o))}
              onDrop={() => drop(lane.id)}
              className={cn(
                "flex w-[272px] shrink-0 flex-col gap-2 rounded-lg p-1 transition-colors duration-150",
                over === lane.id && dragging && "bg-muted/60",
              )}
            >
              <header className="flex h-7 items-center gap-2 px-1.5">
                <StatusBadge label={lane.label} tone={lane.tone} className="font-medium text-foreground" />
                <span className="text-[12px] text-muted-foreground tabular">{cards.length}</span>
              </header>
              <div className="flex flex-col gap-2 overflow-y-auto">
                {cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    entity={entity}
                    record={card}
                    dragging={dragging === card.id}
                    fresh={!!fresh[card.id]}
                    onOpen={() => openRecord(card.id)}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    snippet={longText ? String(card.data[longText.id] ?? "") : ""}
                    fields={view.cardFieldIds}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => openCreate(entity.id, { [status.id]: lane.id })}
                className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <PlusIcon className="size-3.5" />
                Add {entity.name.toLowerCase()}
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({
  entity,
  record,
  dragging,
  fresh,
  onOpen,
  onDragStart,
  onDragEnd,
  snippet,
  fields,
}: {
  entity: Entity;
  record: DataRecord;
  dragging: boolean;
  fresh: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  snippet: string;
  fields: string[];
}) {
  const due = fields.map((id) => getField(entity, id)).find((f) => f.type === "date");
  const isDueToday = due ? record.data[due.id] === todayKey() : false;
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "relative flex cursor-grab flex-col gap-2 rounded-lg border bg-card p-3 text-[13px] transition-[border-color,opacity] duration-150",
        "hover:border-foreground/20 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/50 active:cursor-grabbing",
        dragging && "scale-[0.98] opacity-50",
        fresh && "animate-flash",
      )}
    >
      <h3 className="font-medium leading-snug">
        {/* The stretched button makes the whole card open the record, with or without a mouse. */}
        <button
          type="button"
          onClick={onOpen}
          className="text-left outline-none after:absolute after:inset-0"
        >
          {recordTitle(entity, record)}
        </button>
      </h3>
      {snippet ? (
        <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{snippet}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {fields.map((id) => {
          const field = getField(entity, id);
          if (field.type === "date" && isDueToday)
            return (
              <span key={id} className="ml-auto text-warning">
                Due today
              </span>
            );
          return (
            <span key={id} className={cn("min-w-0", field.type === "date" && "ml-auto")}>
              {field.type === "select" ? (
                optionOf(field, record.data[id])?.label
              ) : (
                <FieldValue field={field} value={record.data[id]} />
              )}
            </span>
          );
        })}
      </div>
    </article>
  );
}
