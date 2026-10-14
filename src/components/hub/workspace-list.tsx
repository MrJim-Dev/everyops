"use client";

import { PlusIcon, RowsIcon, SquaresFourIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/views/search-input";
import { ViewEmpty } from "@/components/views/view-empty";
import { useCurrentUser } from "@/lib/auth/client";
import { usePublished } from "@/lib/community/published";
import { useHydrated } from "@/lib/store/use-hydrated";
import { recordCount, roleOf } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";
import { WorkspaceCard } from "./workspace-card";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceRow } from "./workspace-row";

type Filter = "all" | "owned" | "shared" | "public";
type Layout = "grid" | "list";
type Sort = "opened" | "records" | "name";
const SORTS: Record<Sort, string> = { opened: "Recently opened", records: "Most records", name: "Name" };

/** Lowercase without accents, so "kape" finds "Kapé". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Every workspace the account owns or was invited to, as project cards or a compact list. */
export function WorkspaceList() {
  const hydrated = useHydrated();
  const user = useCurrentUser();
  const router = useRouter();
  const all = useWorkspaces((s) => s.workspaces);
  const listings = usePublished((s) => s.systems);
  const loadCommunity = usePublished((s) => s.load);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayout] = useState<Layout>("grid");
  const [sort, setSort] = useState<Sort>("opened");
  // One clock for the whole page, so every "this week" agrees. Only rendered in the browser.
  const now = useMemo(() => Date.now(), []);

  // Community listings tell each workspace whether it's public.
  useEffect(() => {
    void loadCommunity();
  }, [loadCommunity]);

  const workspaces = useMemo(
    () => Object.values(all).sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [all],
  );
  const publicSlugs = useMemo(() => new Set(listings.map((l) => l.sourceWorkspaceId)), [listings]);
  const owned = workspaces.filter((w) => w.ownerId === user?.id).length;
  const shared = workspaces.length - owned;

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return workspaces
      .filter((w) => {
        if (filter === "owned") return w.ownerId === user?.id;
        if (filter === "shared") return w.ownerId !== user?.id;
        if (filter === "public") return publicSlugs.has(w.slug);
        return true;
      })
      .filter((w) => !q || fold(`${w.name} ${w.summary}`).includes(q))
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "records"
            ? recordCount(b) - recordCount(a)
            : 0,
      );
  }, [workspaces, query, filter, sort, user?.id, publicSlugs]);

  const filters = [
    { value: "all", label: `All ${workspaces.length}` },
    { value: "owned", label: `Owned ${owned}` },
    ...(shared ? [{ value: "shared", label: `Shared ${shared}` }] : []),
    { value: "public", label: `Public ${workspaces.filter((w) => publicSlugs.has(w.slug)).length}` },
  ];

  return (
    <>
      <div className="animate-rise flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em]">Workspaces</h1>
          <p className="text-[14px] text-muted-foreground">
            {hydrated
              ? `${owned} owned by you${shared ? `, ${shared} shared with you` : ""}. Make one public to share its design in Community.`
              : "Workspaces you own or were invited to."}
          </p>
        </div>
        <Button className="h-9 px-3.5" render={<Link href="/" />} nativeButton={false}>
          <PlusIcon data-icon="inline-start" />
          New workspace
        </Button>
      </div>

      {!hydrated ? (
        <GridSkeleton />
      ) : workspaces.length === 0 ? (
        <ViewEmpty
          title="No workspaces yet"
          description="Describe your business and EveryOps builds your first workspace."
          actionLabel="New workspace"
          onAction={() => router.push("/")}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <WorkspaceOverview
            workspaces={workspaces}
            publicCount={workspaces.filter((w) => publicSlugs.has(w.slug)).length}
            now={now}
          />
          <div
            className="animate-rise stagger flex flex-wrap items-center gap-3"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            <div className="min-w-[200px] flex-1 sm:max-w-[300px] [&>div]:max-w-none">
              <SearchInput value={query} onChange={setQuery} placeholder="Find a workspace" />
            </div>
            <SegmentedControl
              label="Show"
              value={filter}
              onValueChange={(v) => setFilter(v as Filter)}
              options={filters}
            />
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)} items={SORTS}>
              <SelectTrigger size="sm" className="ml-auto w-[152px]" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {Object.entries(SORTS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <SegmentedControl
              label="Layout"
              variant="boxed"
              value={layout}
              onValueChange={(v) => setLayout(v as Layout)}
              options={[
                { value: "grid", label: <SquaresFourIcon aria-label="Grid" className="size-4" /> },
                { value: "list", label: <RowsIcon aria-label="List" className="size-4" /> },
              ]}
            />
          </div>
          {visible.length === 0 ? (
            <ViewEmpty
              title={filter === "public" ? "Nothing is public yet" : "No workspaces match"}
              description={
                filter === "public"
                  ? "Use Make public on any workspace you own to share its design in Community."
                  : "Try another name or filter."
              }
            />
          ) : layout === "grid" ? (
            <div key="grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((w, i) => (
                <WorkspaceCard
                  key={w.slug}
                  workspace={w}
                  role={roleOf(w, user?.id)}
                  index={i + 3}
                  now={now}
                />
              ))}
              <NewWorkspaceTile index={visible.length + 3} />
            </div>
          ) : (
            <ul key="list" className="animate-rise divide-y overflow-hidden rounded-xl border">
              {visible.map((w) => (
                <WorkspaceRow key={w.slug} workspace={w} role={roleOf(w, user?.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function NewWorkspaceTile({ index }: { index: number }) {
  return (
    <Link
      href="/"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
      className="animate-rise stagger group flex min-h-[118px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed text-center outline-none transition-[border-color,background-color] duration-200 hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex size-10 items-center justify-center rounded-xl border border-dashed text-muted-foreground transition-colors duration-200 group-hover:border-primary/40 group-hover:text-primary">
        <PlusIcon className="size-4.5" />
      </span>
      <span>
        <span className="block text-[14px] font-medium">New workspace</span>
        <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
          Describe your business and we'll build it
        </span>
      </span>
    </Link>
  );
}

/** Same shape as the cards, so nothing jumps when workspaces arrive. */
export function GridSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading workspaces</span>
      <Skeleton className="h-[110px] rounded-xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col gap-5 rounded-xl border border-foreground/[0.06] p-4">
            <div className="flex gap-3">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </div>
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
