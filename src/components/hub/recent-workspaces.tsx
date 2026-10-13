"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { WorkspaceTile } from "@/components/shell/workspace-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentWorkspaces } from "@/lib/store/selectors";
import { useHydrated } from "@/lib/store/use-hydrated";

export function RecentWorkspaces() {
  const hydrated = useHydrated();
  const workspaces = useRecentWorkspaces();

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {workspaces.map((w) => (
        <li key={w.slug}>
          <Link
            href={w.settingUp ? `/w/${w.slug}/ask` : `/w/${w.slug}`}
            className="group flex h-14 items-center gap-3 px-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted"
          >
            <WorkspaceTile name={w.name} className="size-7 text-[12px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{w.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {w.settingUp
                  ? "Setting up with Ask Hulma"
                  : w.shared
                    ? `Shared with you · ${w.summary}`
                    : w.summary}
              </span>
            </span>
            <span className="hidden text-[12px] text-muted-foreground sm:inline">
              Opened {formatDistanceToNowStrict(new Date(w.openedAt), { addSuffix: true })}
            </span>
            <ArrowRightIcon className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
