"use client";

import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import type { WorkspaceData } from "@/lib/blueprint/types";
import type { CatalogSystem } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { ShotContent } from "./shot-views";

/** A fixed date keeps catalog screenshots identical on the server and in the browser. */
export const SHOT_DATE = new Date("2026-10-13T09:00:00+08:00");
const WIDTH = 1000;
const HEIGHT = 625;

/**
 * Renders a full-size app screen and scales it to the box's width, so text stays crisp at any size.
 * Decorative: the real screen is one click away.
 */
export function ScaledScreen({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const box = outer.current;
    const screen = inner.current;
    if (!box || !screen) return;
    const fit = () => {
      screen.style.transform = `scale(${box.clientWidth / WIDTH})`;
      setReady(true);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      aria-hidden="true"
      className={cn("relative aspect-[16/10] overflow-hidden bg-background select-none", className)}
    >
      <div
        ref={inner}
        style={{ width: WIDTH, height: HEIGHT }}
        className={cn(
          "absolute top-0 left-0 origin-top-left transition-opacity duration-200 ease-(--ease-out-strong)",
          ready ? "opacity-100" : "opacity-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A community system's first screen, from its own sample data. */
export function SystemShot({ system, className }: { system: CatalogSystem; className?: string }) {
  const data = useMemo(() => system.sample(SHOT_DATE), [system]);
  return (
    <ScaledScreen className={className}>
      <AppScreen data={data} date={SHOT_DATE} />
    </ScaledScreen>
  );
}

/** The app as it looks inside a workspace: sidebar, page header and the first screen's content. */
export function AppScreen({ data, date }: { data: WorkspaceData; date: Date }) {
  const { systems, views, entities } = data.blueprint;
  // Lead with the screen that defines the product (the schedule, the register), not the overview.
  const first = systems.find((s) => s.viewIds.length) ?? systems[0];
  const view = first ? views.find((v) => v.id === first.viewIds[0]) : undefined;
  const entity = view ? entities.find((e) => e.id === view.entityId) : undefined;

  return (
    <div className="flex h-full bg-shell text-[13px] text-foreground">
      <aside className="flex w-[210px] shrink-0 flex-col gap-1 border-r p-3">
        <div className="mb-2 flex items-center gap-2 px-1.5 py-1">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
            {data.blueprint.workspaceName.slice(0, 1)}
          </span>
          <span className="truncate font-medium">{data.blueprint.workspaceName}</span>
        </div>
        <div className="mb-3 flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-muted-foreground">
          <MagnifyingGlassIcon className="size-3.5" />
          Search
        </div>
        {systems.map((s) => (
          <div
            key={s.id}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground",
              s.id === first?.id && "bg-secondary text-foreground",
            )}
          >
            <SystemIcon name={s.icon} className="size-4" />
            <span className="truncate">{s.name}</span>
          </div>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">{first?.name ?? "Overview"}</span>
          {entity ? (
            <span className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground">
              <PlusIcon weight="bold" className="size-3.5" />
              New {entity.name.toLowerCase()}
            </span>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-hidden p-6">
          <ShotContent view={view} data={data} date={date} />
        </div>
      </main>
    </div>
  );
}
