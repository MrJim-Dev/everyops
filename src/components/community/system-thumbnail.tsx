"use client";

import { useMemo } from "react";
import { recordsOf, recordTitle } from "@/lib/blueprint/lookup";
import type { View, WorkspaceData } from "@/lib/blueprint/types";
import type { CatalogSystem } from "@/lib/catalog";
import { formatMoney, isTimeRange } from "@/lib/format";
import { dateKey, manilaParts } from "@/lib/time";
import { cn } from "@/lib/utils";

/** A fixed date keeps thumbnails identical on the server and in the browser. */
const THUMBNAIL_DATE = new Date("2026-10-13T09:00:00+08:00");

/**
 * A miniature of the system's first screen, drawn from its own blueprint and
 * sample data. Decorative: the real screen is one click away in Preview.
 */
export function SystemThumbnail({ system, className }: { system: CatalogSystem; className?: string }) {
  const data = useMemo(() => system.sample(THUMBNAIL_DATE), [system]);
  // Show the system that defines the product (e.g. the schedule), not the overview.
  const first = data.blueprint.systems.find((s) => s.viewIds.length) ?? data.blueprint.systems[0];
  const view = first ? data.blueprint.views.find((v) => v.id === first.viewIds[0]) : undefined;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex aspect-[16/10] overflow-hidden rounded-md border bg-shell text-[6.5px] leading-tight select-none",
        className,
      )}
    >
      <div className="flex w-[22%] flex-col gap-1 border-r p-2">
        <div className="mb-1 h-1.5 w-3/4 rounded-full bg-foreground/25" />
        {data.blueprint.systems.map((s, i) => (
          <div
            key={s.id}
            className={cn(
              "truncate rounded-[2px] px-1 py-0.5 text-muted-foreground",
              i === 0 && "bg-secondary text-foreground",
            )}
          >
            {s.name}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex items-center justify-between border-b px-2 py-1.5">
          <span className="text-[8px] font-semibold text-foreground">{first?.name}</span>
          <span className="h-2 w-6 rounded-[2px] bg-primary/80" />
        </div>
        <div className="min-h-0 flex-1 p-1.5">
          {view ? <Mini view={view} data={data} /> : <MiniDashboard />}
        </div>
      </div>
    </div>
  );
}

function Mini({ view, data }: { view: View; data: WorkspaceData }) {
  const entity = data.blueprint.entities.find((e) => e.id === view.entityId);
  if (!entity) return null;
  const rows = recordsOf(data.records, entity.id);

  switch (view.type) {
    case "slot_grid": {
      const booking = entity.booking;
      const resourceId =
        entity.fields.find((f) => f.id === booking?.resourceFieldId)?.relation?.entityId ?? "";
      const resources = recordsOf(data.records, resourceId).slice(0, 4);
      const today = rows.filter((r) => {
        const range = r.data[booking?.timeFieldId ?? ""];
        return isTimeRange(range) && dateKey(range.start) === dateKey(THUMBNAIL_DATE);
      });
      return (
        <div className="grid h-full grid-cols-4 gap-px">
          {resources.map((res) => (
            <div key={res.id} className="relative border-l border-border/60">
              {today
                .filter((b) => b.data[booking?.resourceFieldId ?? ""] === res.id)
                .map((b) => {
                  const start = manilaParts(
                    (b.data[booking?.timeFieldId ?? ""] as { start: string }).start,
                  ).hour;
                  return (
                    <div
                      key={b.id}
                      className="absolute inset-x-0.5 truncate rounded-[2px] border-l-2 border-primary/70 bg-card px-0.5 text-foreground"
                      style={{ top: `${((start - 9) / 12) * 100}%`, height: "7%" }}
                    >
                      {recordTitle(entity, b)}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      );
    }
    case "kanban": {
      const status = entity.fields.find((f) => f.id === view.statusFieldId);
      return (
        <div className="grid h-full grid-cols-4 gap-1">
          {(status?.options ?? []).slice(0, 4).map((o) => (
            <div key={o.id} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">{o.label}</span>
              {rows
                .filter((r) => r.data[view.statusFieldId] === o.id)
                .slice(0, 3)
                .map((r) => (
                  <div key={r.id} className="truncate rounded-[2px] border bg-card px-1 py-1 text-foreground">
                    {recordTitle(entity, r)}
                  </div>
                ))}
            </div>
          ))}
        </div>
      );
    }
    case "checkout": {
      const products = recordsOf(data.records, view.productEntityId).slice(0, 7);
      const productEntity = data.blueprint.entities.find((e) => e.id === view.productEntityId);
      return (
        <div className="grid h-full grid-cols-[1.6fr_1fr] gap-1.5">
          <div className="flex flex-col">
            {products.map((p) => (
              <div
                key={p.id}
                className="flex justify-between border-b border-border/60 py-[3px] text-foreground"
              >
                <span className="truncate">{productEntity ? recordTitle(productEntity, p) : ""}</span>
                <span className="font-mono text-muted-foreground">₱{String(p.data.price ?? "")}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-end gap-1 rounded-[2px] border bg-card p-1">
            <span className="text-muted-foreground">Total</span>
            <span className="font-mono text-[9px] text-foreground">
              {formatMoney(products.slice(0, 3).reduce((sum, p) => sum + Number(p.data.price ?? 0), 0))}
            </span>
            <span className="h-2.5 rounded-[2px] bg-primary/80" />
          </div>
        </div>
      );
    }
    case "calendar":
      return (
        <div className="grid h-full grid-cols-7 gap-px">
          {Array.from({ length: 28 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative grid, never reordered
            <div key={i} className="border border-border/50 p-0.5">
              {(i * 7) % 5 === 1 ? <div className="h-1 rounded-full bg-primary/70" /> : null}
              {(i * 3) % 7 === 2 ? <div className="mt-0.5 h-1 rounded-full bg-muted-foreground/40" /> : null}
            </div>
          ))}
        </div>
      );
    case "approval_queue":
      return (
        <div className="flex flex-col">
          {rows.slice(0, 5).map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-1 border-b border-border/60 py-1 text-foreground"
            >
              <span className="flex-1 truncate">{recordTitle(entity, r)}</span>
              <span className="rounded-[2px] border px-1 text-muted-foreground">Decline</span>
              <span className="rounded-[2px] bg-primary/80 px-1 text-primary-foreground">Approve</span>
            </div>
          ))}
        </div>
      );
    default:
      return (
        <div className="flex flex-col">
          {rows.slice(0, 8).map((r) => (
            <div key={r.id} className="truncate border-b border-border/60 py-[3px] text-foreground">
              {recordTitle(entity, r)}
            </div>
          ))}
        </div>
      );
  }
}

function MiniDashboard() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-0.5 border-r border-border/60 last:border-r-0">
            <span className="h-1 w-6 rounded-full bg-muted-foreground/40" />
            <span className="h-2 w-10 rounded-full bg-foreground/60" />
          </div>
        ))}
      </div>
      <svg aria-hidden="true" viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="1.2"
          points="0,30 12,26 24,28 36,20 48,22 60,14 72,17 84,9 100,11"
        />
        <polyline
          fill="none"
          stroke="var(--chart-2)"
          strokeWidth="1"
          points="0,36 12,34 24,35 36,31 48,33 60,30 72,31 84,28 100,29"
        />
      </svg>
    </div>
  );
}
