"use client";

import { ArrowSquareOutIcon, CopyIcon, GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { FormView, LandingView } from "@/lib/blueprint/types";
import { isPublic, sitePath } from "@/lib/public/resolve";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";

/** Above a form or landing page: whether it's public, its link, and (for owners and admins) a switch. */
export function PublicBar({ view, children }: { view: FormView | LandingView; children?: React.ReactNode }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const live = ws.mode === "live";
  const on = isPublic(view);
  const path = sitePath(ws.id, view.id);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  const toggle = () => {
    const entry = applyChange(ws.id, {
      request: `${on ? "Hide" : "Publish"} ${view.name}`,
      title: on ? `Make ${view.name} private` : `Publish ${view.name}`,
      facts: [],
      steps: [{ kind: "change", label: view.name, detail: on ? "Public → Team only" : "Team only → Public" }],
      ops: [{ op: "update_view", viewId: view.id, patch: { public: !on } }],
    });
    if (entry)
      toast(on ? `${view.name} is now private` : `${view.name} is public`, {
        description: on ? undefined : url,
      });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[12.5px]">
      {on ? (
        <GlobeIcon className="size-4 text-primary" />
      ) : (
        <LockSimpleIcon className="size-4 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {on ? (
          <>
            Public at <span className="font-mono text-foreground">{path}</span>
          </>
        ) : (
          "Only your team can see this page."
        )}
      </span>
      {children}
      {on && live ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(url).then(() => toast("Link copied"))}
          >
            <CopyIcon data-icon="inline-start" />
            Copy link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={path} target="_blank" rel="noreferrer" />}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            Open
          </Button>
        </>
      ) : null}
      {live && canManage(ws.role) ? (
        <Button size="sm" variant={on ? "outline" : "default"} onClick={toggle}>
          {on ? "Make private" : "Make public"}
        </Button>
      ) : null}
    </div>
  );
}
