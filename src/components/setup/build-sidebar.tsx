"use client";

import { CheckIcon, GlobeSimpleIcon } from "@phosphor-icons/react";
import { ACTIVE_ITEM, RAIL_ITEM, RAIL_LABEL, railWidth } from "@/components/shell/sidebar-link";
import { SystemIcon } from "@/components/system-icon";
import type { IconName } from "@/lib/blueprint/types";
import { useBuildOf, useSetupSketch } from "@/lib/store/setup-build";
import { cn } from "@/lib/utils";
import { focusOf, isSitePage, stepOf } from "./build-model";

/** Something that just arrived: a teal tint behind it that comes up and fades as it lands. */
export function Landed() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 animate-land rounded-[inherit] bg-primary/15"
    />
  );
}

/**
 * The pages of a workspace being set up, in the real sidebar. While Gemini designs it, each page is tossed in as it's
 * named, the one being built carries the current-page tint and a live dot, and built ones get a check; when the
 * design is ready the checks run down the list. Afterwards the draft's pages stay listed until it's created.
 * Rows aren't links (the pages don't exist yet), but they match SidebarLink so nothing moves when they become real.
 */
export function BuildPages({
  workspaceId,
  site = false,
  rail,
}: {
  workspaceId: string;
  site?: boolean;
  rail: boolean;
}) {
  const build = useBuildOf(workspaceId);
  const sketch = useSetupSketch(workspaceId);
  const all = sketch?.pages ?? [];
  const pages = all.filter((p) => isSitePage(p) === site);
  const finishing = !!build && build.stage !== "design";
  const at = build ? stepOf(build) : 0;
  const focus = build ? focusOf(sketch, finishing) : undefined;
  const focusAt = focus ? all.indexOf(focus) : -1;
  const building = at === 2;
  const pastViews = at >= 3;

  if (build && !all.length && !site)
    return (
      <div aria-hidden className="flex flex-col gap-px">
        {[88, 112, 72].map((w, i) => (
          <div key={w} className="flex h-8 items-center gap-2.5 px-2" style={{ opacity: 1 - i * 0.25 }}>
            <span className="size-4 shrink-0 animate-pulse rounded bg-sidebar-accent" />
            <span
              className={cn("h-2.5 animate-pulse rounded bg-sidebar-accent", RAIL_LABEL)}
              style={{ width: w }}
            />
          </div>
        ))}
      </div>
    );

  return pages.map((p) => {
    const index = all.indexOf(p);
    const current = !!build && p === focus && !finishing && (building || pastViews);
    const built = !!build && (finishing || (pastViews ? p !== focus : building && index < focusAt));
    return (
      // The wrapper stays still so the build cursor can find where the row lands while it's still flying in.
      <div key={p.id} data-build-target={`page:${p.id}`} className={cn("h-8", RAIL_ITEM, railWidth(rail))}>
        <div
          data-active={current}
          title={build ? undefined : "Created when you press Create workspace"}
          className={cn(
            "flex h-8 animate-throw-in items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground",
            ACTIVE_ITEM,
            "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
            !build && "text-muted-foreground",
          )}
        >
          <Landed />
          {site ? <GlobeSimpleIcon /> : <SystemIcon name={(p.icon ?? "gauge") as IconName} />}
          <span className={cn("flex-1 truncate", RAIL_LABEL)}>{p.name}</span>
          {built ? (
            <CheckIcon
              key={build?.ready ? "ready" : "built"}
              weight="bold"
              className={cn("size-3! animate-pop text-primary! [animation-fill-mode:both]", RAIL_LABEL)}
              style={build?.ready ? { animationDelay: `${index * 45}ms` } : undefined}
            />
          ) : current ? (
            <span
              className={cn("mr-0.5 size-1.5 shrink-0 animate-live rounded-full bg-primary", RAIL_LABEL)}
            />
          ) : null}
        </div>
      </div>
    );
  });
}
