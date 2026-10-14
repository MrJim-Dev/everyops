"use client";

import { GlobeHemisphereWestIcon, SquaresFourIcon, StackIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { formatNumber } from "@/lib/format";
import type { Workspace } from "@/lib/store/workspace-model";
import { workspaceStats } from "./workspace-stats";

/** Totals across every workspace, so the page answers "how's the business doing" before any card. */
export function WorkspaceOverview({
  workspaces,
  publicCount,
  now,
}: {
  workspaces: Workspace[];
  publicCount: number;
  now: number;
}) {
  const all = workspaces.map((w) => workspaceStats(w, now));
  const records = all.reduce((n, s) => n + s.records, 0);
  const thisWeek = all.reduce((n, s) => n + s.recordsThisWeek, 0);
  const people = new Set(all.flatMap((s) => s.team.map((p) => p.id))).size;
  const invited = all.reduce((n, s) => n + s.invited, 0);

  const items = [
    {
      icon: SquaresFourIcon,
      label: "Workspaces",
      value: formatNumber(workspaces.length),
      note: `${all.reduce((n, s) => n + s.systems.length, 0)} systems inside`,
    },
    {
      icon: StackIcon,
      label: "Records",
      value: formatNumber(records),
      note: thisWeek ? `+${formatNumber(thisWeek)} this week` : "None added this week",
      accent: thisWeek > 0,
    },
    {
      icon: UsersThreeIcon,
      label: "People",
      value: formatNumber(people),
      note: invited
        ? `${invited} invite${invited === 1 ? "" : "s"} pending`
        : "Invite your team from Settings",
    },
    {
      icon: GlobeHemisphereWestIcon,
      label: "Public in Community",
      value: formatNumber(publicCount),
      note: publicCount ? "Shared as templates" : "None shared yet",
    },
  ];

  return (
    <dl
      className="animate-rise stagger grid grid-cols-2 overflow-hidden rounded-xl border border-foreground/[0.08] bg-card/30 lg:grid-cols-4"
      style={{ "--i": 1 } as React.CSSProperties}
    >
      {items.map(({ icon: Icon, label, value, note, accent }, i) => (
        <div
          key={label}
          className={`flex flex-col gap-1 px-5 py-4 ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""} border-foreground/[0.06]`}
        >
          <dt className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Icon className="size-3.5" />
            {label}
          </dt>
          <dd className="text-[22px] font-semibold tracking-[-0.02em] tabular">{value}</dd>
          <dd className={`text-[12px] ${accent ? "text-primary" : "text-muted-foreground"}`}>{note}</dd>
        </div>
      ))}
    </dl>
  );
}
