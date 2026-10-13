"use client";

import { ArrowRightIcon, PlusIcon } from "@phosphor-icons/react";
import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { WorkspaceTile } from "@/components/shell/workspace-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/views/search-input";
import { ViewEmpty } from "@/components/views/view-empty";
import { useRecentWorkspaces } from "@/lib/store/selectors";
import { useHydrated } from "@/lib/store/use-hydrated";

type Filter = "all" | "owned" | "shared";

/** Lowercase without accents, so "kape" finds "Kapé". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Every workspace the signed-in account owns or was invited to, most recently opened first. */
export function WorkspaceList() {
  const hydrated = useHydrated();
  const workspaces = useRecentWorkspaces();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const ownedCount = workspaces.filter((w) => !w.shared).length;
  const sharedCount = workspaces.length - ownedCount;

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return workspaces
      .filter((w) => filter === "all" || (filter === "shared") === w.shared)
      .filter((w) => !q || fold(`${w.name} ${w.summary}`).includes(q));
  }, [workspaces, query, filter]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight">Workspaces</h1>
          <p className="text-[14px] text-muted-foreground">
            {hydrated
              ? `${ownedCount} owned by you${sharedCount ? `, ${sharedCount} shared with you` : ""}`
              : "Workspaces you own or were invited to."}
          </p>
        </div>
        <Button size="sm" render={<Link href="/" />} nativeButton={false}>
          <PlusIcon data-icon="inline-start" />
          New workspace
        </Button>
      </div>

      {!hydrated ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">Loading</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : workspaces.length === 0 ? (
        <ViewEmpty
          title="No workspaces yet"
          description="Describe your business and EveryOps builds your first workspace."
          actionLabel="New workspace"
          onAction={() => router.push("/")}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Find a workspace" />
            {sharedCount > 0 ? (
              <SegmentedControl
                label="Show"
                value={filter}
                onValueChange={(v) => setFilter(v as Filter)}
                options={[
                  { value: "all", label: "All" },
                  { value: "owned", label: "Owned" },
                  { value: "shared", label: "Shared with you" },
                ]}
              />
            ) : null}
          </div>
          {visible.length === 0 ? (
            <ViewEmpty title="No workspaces match" description="Try another name or filter." />
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border">
              {visible.map((w) => (
                <li key={w.slug}>
                  <Link
                    href={w.settingUp ? `/w/${w.slug}/ask` : `/w/${w.slug}`}
                    className="group flex min-h-16 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted"
                  >
                    <WorkspaceTile name={w.name} className="size-8 text-[13px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium">{w.name}</span>
                        {w.shared ? <Badge variant="secondary">Shared</Badge> : null}
                        {w.settingUp ? <Badge variant="outline">Setting up</Badge> : null}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {w.settingUp ? "Continue the setup with Ask EveryOps" : w.summary}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
                      Opened {formatDistanceToNowStrict(new Date(w.openedAt), { addSuffix: true })}
                    </span>
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
