"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { WorkspaceTile } from "@/components/shell/workspace-tile";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { type Role, recordCount, type Workspace } from "@/lib/store/workspace-model";
import { ROLE_LABEL } from "./workspace-card";
import { WorkspaceVisibility } from "./workspace-visibility";

/** Compact row for the list layout. */
export function WorkspaceRow({ workspace: ws, role }: { workspace: Workspace; role: Role | null }) {
  const settingUp = !!ws.setup;
  return (
    <li className="flex items-center gap-3 pr-4 transition-colors hover:bg-muted/40">
      <Link
        href={settingUp ? `/w/${ws.slug}/ask` : `/w/${ws.slug}`}
        className="group flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4 outline-none focus-visible:bg-muted"
      >
        <WorkspaceTile
          name={ws.name}
          className="size-8 rounded-lg bg-primary/10 text-[13px] text-primary ring-primary/20"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{ws.name}</span>
            {role && role !== "owner" ? <Badge variant="secondary">{ROLE_LABEL[role]}</Badge> : null}
            {settingUp ? <Badge variant="outline">Setting up</Badge> : null}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {settingUp ? "Continue the setup with Ask EveryOps" : ws.summary}
          </span>
        </span>
        <span className="hidden w-24 shrink-0 text-right text-[12px] text-muted-foreground tabular lg:inline">
          {formatNumber(recordCount(ws))} records
        </span>
        <span className="hidden w-36 shrink-0 text-right text-[12px] text-muted-foreground md:inline">
          Opened {formatDistanceToNowStrict(new Date(ws.openedAt), { addSuffix: true })}
        </span>
      </Link>
      <WorkspaceVisibility slug={ws.slug} />
      <ArrowRightIcon aria-hidden="true" className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
    </li>
  );
}
