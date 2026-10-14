"use client";

import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import type { Widget } from "@/lib/blueprint/types";
import { widgetRows } from "@/lib/engine/aggregate";
import { sortRecords } from "@/lib/engine/query";
import { useFreshStore } from "@/lib/motion/fresh";
import { cn } from "@/lib/utils";
import { WidgetFrame } from "./widget-frame";

export function ListWidget({ widget, viewHref }: { widget: Widget; viewHref?: string }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const fresh = useFreshStore((s) => s.ids);
  const entity = getEntity(blueprint, widget.entityId);
  const config = widget.list ?? { fieldIds: [], limit: 5 };
  const all = sortRecords(widgetRows(blueprint, widget, records), config.sort);
  const rows = all.slice(0, config.limit);
  // Each row already leads with the record's name, so the name field isn't shown again under it.
  const fields = config.fieldIds
    .filter((id) => id !== entity.primaryFieldId)
    .map((id) => getField(entity, id));

  return (
    <WidgetFrame
      title={all.length ? `${widget.title} · ${all.length}` : widget.title}
      href={all.length > rows.length ? viewHref : undefined}
    >
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">Nothing here right now.</p>
      ) : (
        <ul className="pb-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => openRecord(r.id)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 px-5 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted",
                  fresh[r.id] && "animate-flash",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{recordTitle(entity, r)}</span>
                  {fields[0] ? (
                    <span className="block truncate text-[12px] text-muted-foreground">
                      <FieldValue field={fields[0]} value={r.data[fields[0].id]} />
                    </span>
                  ) : null}
                </span>
                {fields.slice(1).map((f, i) => (
                  <span
                    key={f.id}
                    className={
                      i === fields.length - 2
                        ? "shrink-0 text-right"
                        : "hidden shrink-0 text-muted-foreground sm:inline"
                    }
                  >
                    <FieldValue field={f} value={r.data[f.id]} />
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
