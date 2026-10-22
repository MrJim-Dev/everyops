"use client";

import { recordsOf, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, Field, View, WorkspaceData } from "@/lib/blueprint/types";
import { formatDate, formatMoney, formatRange, isTimeRange } from "@/lib/format";
import { dateKey, zonedParts } from "@/lib/time";
import { cn } from "@/lib/utils";

/** A readable value for any field, without the workspace context the real views need. */
function show(field: Field | undefined, record: DataRecord, data: WorkspaceData): string {
  if (!field) return "";
  const v = record.data[field.id];
  if (v === null || v === undefined || v === "") return "—";
  if (field.options) return field.options.find((o) => o.id === v)?.label ?? String(v);
  if (field.type === "money") return formatMoney(Number(v));
  if (field.type === "relation" && field.relation) {
    const target = data.blueprint.entities.find((e) => e.id === field.relation?.entityId);
    const rec = data.records.find((r) => r.id === v);
    return target && rec ? recordTitle(target, rec) : "—";
  }
  if (isTimeRange(v)) return formatRange(v);
  if (field.type === "date" && typeof v === "string") return formatDate(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return typeof v === "object" ? "—" : String(v);
}

/** The field that best describes a record after its title. */
function detailField(entity: Entity) {
  return entity.fields.find(
    (f) => f.id !== entity.primaryFieldId && ["select", "money", "relation", "date", "text"].includes(f.type),
  );
}

export function ShotContent({ view, data, date }: { view?: View; data: WorkspaceData; date: Date }) {
  const entity = view ? data.blueprint.entities.find((e) => e.id === view.entityId) : undefined;
  if (!view || !entity) return <Overview />;
  const rows = recordsOf(data.records, entity.id);

  switch (view.type) {
    case "slot_grid":
      return <Schedule entity={entity} rows={rows} data={data} date={date} />;
    case "kanban": {
      const status = entity.fields.find((f) => f.id === view.statusFieldId);
      const detail = detailField(entity);
      return (
        <div className="grid h-full grid-cols-4 gap-4">
          {(status?.options ?? []).slice(0, 4).map((o) => {
            const items = rows.filter((r) => r.data[view.statusFieldId] === o.id);
            return (
              <div key={o.id} className="flex flex-col gap-2.5">
                <p className="flex items-center gap-2 font-medium">
                  <span className="size-2 rounded-full bg-primary/70" />
                  {o.label}
                  <span className="text-muted-foreground">{items.length}</span>
                </p>
                {items.slice(0, 4).map((r) => (
                  <div key={r.id} className="rounded-lg border bg-card px-3 py-2.5">
                    <p className="truncate font-medium">{recordTitle(entity, r)}</p>
                    <p className="mt-1 truncate text-[12px] text-muted-foreground">{show(detail, r, data)}</p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      );
    }
    case "checkout": {
      const productEntity = data.blueprint.entities.find((e) => e.id === view.productEntityId);
      const products = recordsOf(data.records, view.productEntityId).slice(0, 9);
      const cart = products.slice(0, 3);
      const total = cart.reduce((sum, p) => sum + Number(p.data.price ?? 0), 0);
      return (
        // The same list the real Register shows: name and price, a count in the order, and a plus button.
        <div className="grid h-full grid-cols-[1fr_260px] gap-5">
          <div className="flex flex-col divide-y rounded-lg border bg-card">
            {products.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {productEntity ? recordTitle(productEntity, p) : ""}
                  </span>
                  <span className="block text-[12px] text-muted-foreground tabular">
                    {formatMoney(Number(p.data.price ?? 0))}
                  </span>
                </span>
                {i < 3 ? <span className="text-[12px] text-primary tabular">×1</span> : null}
                <span className="flex size-6 items-center justify-center rounded-md border text-muted-foreground">
                  +
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col rounded-xl border bg-card p-4">
            <p className="font-medium">Current order</p>
            <div className="mt-3 flex flex-col gap-2">
              {cart.map((p) => (
                <div key={p.id} className="flex justify-between gap-3 text-[12.5px]">
                  <span className="truncate">{productEntity ? recordTitle(productEntity, p) : ""}</span>
                  <span className="tabular text-muted-foreground">
                    {formatMoney(Number(p.data.price ?? 0))}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-baseline justify-between border-t pt-3">
              <span className="text-muted-foreground">Total</span>
              <span className="text-[20px] font-semibold tabular">{formatMoney(total)}</span>
            </div>
            <span className="mt-3 rounded-md bg-primary py-2 text-center font-medium text-primary-foreground">
              Complete sale · {formatMoney(total)}
            </span>
          </div>
        </div>
      );
    }
    case "approval_queue": {
      const detail = detailField(entity);
      return (
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          {rows.slice(0, 7).map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-4 py-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-[11px] font-medium">
                {recordTitle(entity, r).slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{recordTitle(entity, r)}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {show(detail, r, data)}
                </span>
              </span>
              <span className="rounded-md border px-3 py-1 text-[12px]">Decline</span>
              <span className="rounded-md bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground">
                Approve
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "calendar":
      return <Month entity={entity} rows={rows} date={date} />;
    default:
      return <Table entity={entity} rows={rows} data={data} />;
  }
}

function Schedule({
  entity,
  rows,
  data,
  date,
}: {
  entity: Entity;
  rows: DataRecord[];
  data: WorkspaceData;
  date: Date;
}) {
  const booking = entity.booking;
  const resourceEntityId =
    entity.fields.find((f) => f.id === booking?.resourceFieldId)?.relation?.entityId ?? "";
  const resourceEntity = data.blueprint.entities.find((e) => e.id === resourceEntityId);
  const resources = recordsOf(data.records, resourceEntityId).slice(0, 4);
  const hours = [9, 10, 11, 12, 13, 14, 15, 16];
  const today = rows.filter((r) => {
    const range = r.data[booking?.timeFieldId ?? ""];
    return isTimeRange(range) && dateKey(range.start) === dateKey(date);
  });
  return (
    <div className="grid h-full grid-cols-[52px_repeat(4,minmax(0,1fr))] grid-rows-[28px_repeat(8,minmax(0,1fr))]">
      {resources.map((res, c) => (
        <span key={res.id} className="truncate px-2 font-medium" style={{ gridColumn: c + 2 }}>
          {resourceEntity ? recordTitle(resourceEntity, res) : ""}
        </span>
      ))}
      {hours.map((h, i) => (
        <span
          key={h}
          className="pt-1 text-[11px] text-muted-foreground"
          style={{ gridRow: i + 2, gridColumn: 1 }}
        >
          {h > 12 ? h - 12 : h} {h >= 12 ? "PM" : "AM"}
        </span>
      ))}
      {hours.flatMap((h, i) =>
        resources.map((res, c) => (
          <span
            key={`${h}-${res.id}`}
            className="border-t border-l border-border/70"
            style={{ gridRow: i + 2, gridColumn: c + 2 }}
          />
        )),
      )}
      {today.map((b) => {
        const range = b.data[booking?.timeFieldId ?? ""];
        const col = resources.findIndex((res) => res.id === b.data[booking?.resourceFieldId ?? ""]);
        if (!isTimeRange(range) || col < 0) return null;
        const start = zonedParts(range.start).hour;
        const end = Math.max(start + 1, zonedParts(range.end).hour);
        if (start < 9 || start > 16) return null;
        return (
          <span
            key={b.id}
            className="m-1 overflow-hidden rounded-md border-l-2 border-primary bg-primary/12 px-2 py-1.5"
            style={{ gridColumn: col + 2, gridRow: `${start - 7} / span ${Math.min(end, 17) - start}` }}
          >
            <span className="block truncate font-medium">{recordTitle(entity, b)}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{formatRange(range)}</span>
          </span>
        );
      })}
    </div>
  );
}

function Month({ entity, rows, date }: { entity: Entity; rows: DataRecord[]; date: Date }) {
  const dateField = entity.fields.find((f) => f.type === "date" || f.type === "datetime");
  const day = zonedParts(date.toISOString()).day;
  return (
    <div className="grid h-full grid-cols-7 grid-rows-[24px_repeat(5,minmax(0,1fr))] overflow-hidden rounded-xl border">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <span key={d} className="border-b px-2 pt-1 text-[11px] text-muted-foreground">
          {d}
        </span>
      ))}
      {Array.from({ length: 35 }, (_, i) => {
        const n = i + 1;
        const events = rows.filter((r) => {
          const v = dateField ? r.data[dateField.id] : undefined;
          return typeof v === "string" && Number(v.slice(8, 10)) === n;
        });
        return (
          <div
            key={n}
            className={cn("flex flex-col gap-1 border-t border-l p-1.5", n === day && "bg-primary/[0.06]")}
          >
            <span
              className={cn("text-[11px] text-muted-foreground", n === day && "font-semibold text-primary")}
            >
              {n <= 31 ? n : ""}
            </span>
            {events.slice(0, 2).map((e) => (
              <span key={e.id} className="truncate rounded bg-primary/15 px-1.5 py-0.5 text-[11px]">
                {recordTitle(entity, e)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Table({ entity, rows, data }: { entity: Entity; rows: DataRecord[]; data: WorkspaceData }) {
  const fields = entity.fields.filter((f) => f.type !== "long_text").slice(0, 5);
  return (
    <div className="overflow-hidden rounded-xl border">
      <div
        className="grid border-b bg-card px-4 py-2.5 text-[12px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}
      >
        {fields.map((f) => (
          <span key={f.id} className="truncate pr-3">
            {f.name}
          </span>
        ))}
      </div>
      {rows.slice(0, 11).map((r) => (
        <div
          key={r.id}
          className="grid border-b px-4 py-2.5 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}
        >
          {fields.map((f, i) => (
            <span
              key={f.id}
              className={cn("truncate pr-3", i === 0 ? "font-medium" : "text-muted-foreground")}
            >
              {show(f, r, data)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Overview() {
  return (
    <div className="flex h-full flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        {["Today", "This week", "This month"].map((label, i) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-[12px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-[22px] font-semibold tabular">{formatMoney([4820, 31250, 128400][i])}</p>
          </div>
        ))}
      </div>
      <div className="flex-1 rounded-xl border bg-card p-4">
        <svg aria-hidden="true" viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="0.8"
            points="0,30 12,26 24,28 36,20 48,22 60,14 72,17 84,9 100,11"
          />
          <polyline
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth="0.6"
            points="0,36 12,34 24,35 36,31 48,33 60,30 72,31 84,28 100,29"
          />
        </svg>
      </div>
    </div>
  );
}
