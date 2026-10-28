"use client";

import { ArrowSquareOutIcon, CopyIcon, GlobeIcon, HouseIcon, LockSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import type { FormView, HtmlPageView, LandingView, LayoutView } from "@/lib/blueprint/types";
import { pageTitle } from "@/lib/pages";
import { htmlConnectionProblems } from "@/lib/public/html-connections";
import { pageHtml } from "@/lib/public/html-page";
import { autoHomeId, isPublic, sitePath } from "@/lib/public/resolve";
import { standardLanding } from "@/lib/public/site-template";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";

/** Above a form or a page: whether anyone with the link can open it, the link, and (for managers) a switch. */
export function PublicBar({
  view,
  children,
}: {
  view: FormView | LandingView | HtmlPageView | LayoutView;
  children?: React.ReactNode;
}) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const sendRequest = useAssistant((s) => s.sendRequest);
  const [warning, setWarning] = useState(false);
  const live = ws.mode === "live";
  // What people call it: the sidebar name when it is the only tab there ("October Report", not "Report").
  const name = pageTitle(
    view,
    ws.blueprint.systems.find((s) => s.viewIds.includes(view.id)),
  );
  const on = isPublic(view);
  const path = sitePath(ws.id, view.id);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  const toggle = () => {
    const entry = applyChange(ws.id, {
      request: `${on ? "Stop sharing" : "Share"} ${name}`,
      title: on ? `Stop sharing ${name}` : `Share ${name} with a link`,
      facts: [],
      steps: [
        {
          kind: "change",
          label: name,
          detail: on ? "Anyone with the link → Team only" : "Team only → Anyone with the link",
        },
      ],
      ops: [{ op: "update_view", viewId: view.id, patch: { public: !on } }],
    });
    if (entry)
      toast.success(on ? `Only your team can open ${name} now` : `${name} is shared`, {
        description: on ? undefined : url,
      });
  };

  /**
   * A page reading the team's own tables shows nothing of them to people outside the team (records are never
   * public unless a table is shared on purpose). Say so before sharing, and offer a version that is safe to share.
   */
  const share = () => {
    if (on || view.type !== "html") return toggle();
    const asShared = {
      ...ws.blueprint,
      views: ws.blueprint.views.map((v) => (v.id === view.id ? { ...view, public: true } : v)),
    };
    if (htmlConnectionProblems(asShared, view.id, pageHtml(view, ws.docs)).length) setWarning(true);
    else toggle();
  };

  // A site with only forms shows a standard home page to visitors; this makes it a real page you can edit.
  const noHome =
    view.type === "form" && on && !ws.blueprint.views.some((v) => v.type === "landing" || v.type === "html");
  const addHome = () => {
    const systemId = ws.blueprint.systems.some((s) => s.id === "website") ? "website_home" : "website";
    const home = standardLanding(ws.blueprint, ws.name, {}, autoHomeId(ws.blueprint));
    const entry = applyChange(ws.id, {
      request: "Add a home page",
      title: "Add a home page",
      facts: [],
      steps: [
        { kind: "add", label: "Home page", detail: "The standard site layout, filled in from your data" },
      ],
      ops: [
        {
          op: "add_system",
          system: { id: systemId, name: "Home", icon: "house", viewIds: [], widgetIds: [] },
        },
        { op: "add_view", systemId, view: home },
      ],
    });
    if (entry)
      toast.success("Home page added", {
        description: "Open Home under Pages in the sidebar and click any section to edit it with AI.",
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
            Anyone with the link can open it · <span className="font-mono text-foreground">{path}</span>
          </>
        ) : (
          "Only your team can open this."
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
        <Button size="sm" variant={on ? "outline" : "default"} onClick={share}>
          {on ? "Stop sharing" : "Share with a link"}
        </Button>
      ) : null}
      <AlertDialog open={warning} onOpenChange={setWarning}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>People outside your team won't see its numbers</AlertDialogTitle>
            <AlertDialogDescription>
              {name} reads your team's own records, and those are never shown to anyone outside the team. Ask
              EveryOps for a version made only of what's safe to share (totals, prices, opening hours), or
              share it as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setWarning(false);
                toggle();
              }}
            >
              Share as it is
            </Button>
            <AlertDialogAction
              onClick={() => {
                setWarning(false);
                sendRequest(
                  `Make a page: a version of ${name} I can share with anyone, showing only what's safe to share publicly`,
                );
              }}
            >
              Make a shareable version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
