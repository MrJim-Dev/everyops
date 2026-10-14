"use client";

import { ArrowSquareOutIcon, CopyIcon, GlobeIcon, HouseIcon, LockSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { FormView, HtmlPageView, LandingView } from "@/lib/blueprint/types";
import { autoHomeId, isPublic, sitePath } from "@/lib/public/resolve";
import { standardLanding } from "@/lib/public/site-template";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";

/** Above a form, landing or custom HTML page: whether it's public, its link, and (for managers) a switch. */
export function PublicBar({
  view,
  children,
}: {
  view: FormView | LandingView | HtmlPageView;
  children?: React.ReactNode;
}) {
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
      toast.success(on ? `${view.name} is now private` : `${view.name} is public`, {
        description: on ? undefined : url,
      });
  };

  // A site with only forms shows a standard home page to visitors; this makes it a real page you can edit.
  const noHome =
    view.type === "form" && on && !ws.blueprint.views.some((v) => v.type === "landing" || v.type === "html");
  const addHome = () => {
    const systemId = ws.blueprint.systems.some((s) => s.id === "website") ? "website_home" : "website";
    const home = standardLanding(ws.blueprint, ws.name, {}, autoHomeId(ws.blueprint));
    const entry = applyChange(ws.id, {
      request: "Add a home page to the website",
      title: "Add a home page",
      facts: [],
      steps: [
        { kind: "add", label: "Home page", detail: "The standard site layout, filled in from your data" },
      ],
      ops: [
        {
          op: "add_system",
          system: { id: systemId, name: "Website", icon: "house", viewIds: [], widgetIds: [] },
        },
        { op: "add_view", systemId, view: home },
      ],
    });
    if (entry)
      toast.success("Home page added", {
        description: "Open Website in the sidebar and click any section to edit it with AI.",
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
      {noHome && live && canManage(ws.role) ? (
        <Button size="sm" variant="outline" onClick={addHome}>
          <HouseIcon data-icon="inline-start" />
          Add home page
        </Button>
      ) : null}
      {on && live ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success("Link copied"))}
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
