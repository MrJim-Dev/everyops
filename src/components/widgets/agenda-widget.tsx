"use client";

import { useState } from "react";
import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import type { Widget } from "@/lib/blueprint/types";
import { type AgendaItem, agendaDays } from "@/lib/engine/dashboard";
import { widgetLook } from "@/lib/engine/widget-look";
import { formatDate, formatTime } from "@/lib/format";
import { useFreshStore } from "@/lib/motion/fresh";
import { todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { WidgetFrame } from "./widget-frame";

const SHOWN = 6;

/**
 * The items worth seeing first: what's next, then the most recent finished ones if there's room,
 * still in time order.
 */
function firstItems(items: AgendaItem[], limit: number) {
  if (items.length <= limit) return items;
  const upcoming = items.filter((i) => !i.past);
  const keep = new Set(upcoming.slice(0, limit));
  for (const item of items.filter((i) => i.past).reverse()) {
    if (keep.size >= limit) break;
    keep.add(item);
  }
  return items.filter((i) => keep.has(i));
}

/** Today (and the next few days) as a timeline: time on the left, what's happening on the right. */
export function AgendaWidget({ widget, viewHref }: { widget: Widget; viewHref?: string }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const fresh = useFreshStore((s) => s.ids);
  const entity = getEntity(blueprint, widget.entityId);
  const fields = (widget.agenda?.fieldIds ?? []).map((id) => getField(entity, id));
  const days = agendaDays(blueprint, widget, records);
  const today = todayKey();
  const total = days.reduce((n, d) => n + d.items.length, 0);
  const [expanded, setExpanded] = useState(false);
  let room = expanded ? Number.POSITIVE_INFINITY : SHOWN;
  const shown = days.map((d) => {
    const items = firstItems(d.items, room);
    room = Math.max(0, room - items.length);
    return { ...d, items };
  });
  const hidden = total - shown.reduce((n, d) => n + d.items.length, 0);

  return (
    <WidgetFrame
      title={total ? `${widget.title} · ${total}` : widget.title}
      look={widgetLook(blueprint, widget)}
      href={viewHref}
    >
      <div className="flex flex-col gap-3 pb-3">
        {shown.map(({ day, items }) => (
          <div key={day} className="flex flex-col">
            {days.length > 1 ? (
              <h3 className="px-5 pb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                {day === today ? "Today" : formatDate(day)}
              </h3>
            ) : null}
            {items.length === 0 ? (
              <p className="px-5 pb-2 text-[13px] text-muted-foreground">Nothing on the schedule.</p>
            ) : (
              <ol>
                {items.map((item) => (
                  <li key={item.record.id}>
                    <button
                      type="button"
                      onClick={() => openRecord(item.record.id)}
                      className={cn(
                        "grid min-h-11 w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted",
                        item.past && "text-muted-foreground",
                        fresh[item.record.id] && "animate-flash",
                      )}
                    >
                      <span className="text-[12.5px] tabular-nums">
                        {item.allDay ? "All day" : formatTime(item.start)}
                        {item.end && !item.allDay ? (
                          <span className="block text-[11px] text-muted-foreground">
                            {formatTime(item.end)}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-7 w-0.5 shrink-0 rounded-full",
                            item.past ? "bg-border" : "bg-primary",
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {recordTitle(entity, item.record)}
                          </span>
                          {fields[0] ? (
                            <span className="block truncate text-[12px] text-muted-foreground">
                              <FieldValue field={fields[0]} value={item.record.data[fields[0].id]} />
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {fields.slice(1).map((f) => (
                          <span key={f.id} className="shrink-0">
                            <FieldValue field={f} value={item.record.data[f.id]} />
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
        {hidden > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mx-5 self-start rounded-sm text-[12.5px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {expanded ? "Show less" : `Show all ${total}`}
          </button>
        ) : null}
      </div>
    </WidgetFrame>
  );
}
