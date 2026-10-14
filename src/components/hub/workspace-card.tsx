"use client";

import { SparkleIcon, StackIcon, TrashIcon, UsersIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { WorkspaceTile } from "@/components/shell/workspace-tile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { Role, Workspace } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";
import { workspaceStats } from "./workspace-stats";
import { WorkspaceVisibility } from "./workspace-visibility";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  viewer: "Viewer",
};

/** A workspace card: what it is, whether it's shared, and its size. The whole card opens it. */
export function WorkspaceCard({
  workspace: ws,
  role,
  index,
  now,
}: {
  workspace: Workspace;
  role: Role | null;
  index: number;
  now: number;
}) {
  const settingUp = !!ws.setup;
  const s = workspaceStats(ws, now);

  return (
    <article
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
      className="animate-rise stagger group relative flex flex-col gap-5 rounded-xl border border-foreground/[0.08] bg-card/40 p-4 transition-[border-color,background-color] duration-200 hover:border-foreground/20 hover:bg-card/70 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        <WorkspaceTile
          name={ws.name}
          className="size-9 rounded-lg bg-primary/10 text-[13px] text-primary ring-primary/20"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={settingUp ? `/w/${ws.slug}/ask` : `/w/${ws.slug}`}
            className="flex items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em] outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            <span className="truncate">{ws.name}</span>
            {role && role !== "owner" ? (
              <span className="shrink-0 rounded-full border px-1.5 text-[10.5px] font-normal leading-4 text-muted-foreground">
                {ROLE_LABEL[role]}
              </span>
            ) : null}
          </Link>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {settingUp ? "Setting up with Ask EveryOps" : ws.summary}
          </p>
        </div>
        <div className="relative z-10 shrink-0">
          {settingUp && role === "owner" ? (
            <DiscardDraft slug={ws.slug} />
          ) : (
            <WorkspaceVisibility slug={ws.slug} compact />
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
        {settingUp ? (
          <span className="flex items-center gap-1.5 text-primary">
            <SparkleIcon weight="fill" className="size-3.5" />
            Continue setup
          </span>
        ) : (
          <>
            <Fact icon={<StackIcon className="size-3.5" />} text={`${formatNumber(s.records)} records`} />
            <Fact
              icon={<UsersIcon className="size-3.5" />}
              text={`${s.team.length} ${s.team.length === 1 ? "person" : "people"}`}
            />
          </>
        )}
      </div>
    </article>
  );
}

/** A setup that never finished is just a conversation: the owner can throw it away from the list. */
function DiscardDraft({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const remove = useWorkspaces((s) => s.deleteWorkspace);
  return (
    <>
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <TrashIcon data-icon="inline-start" />
        Discard
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this setup?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation with Ask EveryOps is removed. Nothing was built yet, so no records are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                remove(slug);
                setOpen(false);
                toast.success("Setup discarded");
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Fact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {icon}
      <span className="tabular">{text}</span>
    </span>
  );
}
