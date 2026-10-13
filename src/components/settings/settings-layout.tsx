"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ViewTabs } from "@/components/motion/view-tabs";
import { PageHeader } from "@/components/shell/page-header";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { canManage } from "@/lib/store/workspaces";

/** Workspace settings: one header, tabs for General, Team and Publish. */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const base = `${ws.basePath}/settings`;
  const tabs = [
    { id: "general", href: base, label: "General" },
    { id: "team", href: `${base}/team`, label: "Team" },
    ...(canManage(ws.role) ? [{ id: "publish", href: `${base}/publish`, label: "Publish" }] : []),
  ];
  const active = tabs.find((t) => t.id !== "general" && pathname.startsWith(t.href))?.id ?? "general";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" description={`Manage ${ws.name}.`} />
      <ViewTabs groupId={`${ws.id}:settings`} label="Settings sections" activeId={active} items={tabs} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
