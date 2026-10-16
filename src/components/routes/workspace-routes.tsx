"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, use, useEffect } from "react";
import { AskChat } from "@/components/assistant/ask-chat";
import { RequireAuth } from "@/components/auth/auth-guards";
import { HistoryList } from "@/components/changes/history-list";
import { SetupInterview } from "@/components/setup/setup-interview";
import { PageHeader } from "@/components/shell/page-header";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { SystemPage } from "@/components/system/system-page";
import { ViewEmpty } from "@/components/views/view-empty";
import { LiveWorkspace } from "@/components/workspace/live-workspace";
import { PreviewWorkspace } from "@/components/workspace/preview-workspace";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";

type Params<T> = Promise<T>;

export function LiveWorkspaceLayout({
  params,
  children,
}: {
  params: Params<{ workspace: string }>;
  children: ReactNode;
}) {
  const { workspace } = use(params);
  return (
    <RequireAuth fallback={<ShellSkeleton />}>
      <LiveWorkspace slug={workspace}>
        <WorkspaceShell>{children}</WorkspaceShell>
      </LiveWorkspace>
    </RequireAuth>
  );
}

export function PreviewWorkspaceLayout({
  params,
  children,
}: {
  params: Params<{ systemId: string }>;
  children: ReactNode;
}) {
  const { systemId } = use(params);
  return (
    <PreviewWorkspace systemId={systemId}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </PreviewWorkspace>
  );
}

/** /w/[workspace] and /preview/[id]: go to Ask EveryOps during setup, otherwise the first system. */
export function FirstSystemRedirect() {
  const ws = useWorkspace();
  const router = useRouter();
  const settingUp = useWorkspaces((s) => (ws.mode === "live" ? !!s.workspaces[ws.id]?.setup : false));
  const first = ws.blueprint.systems[0];
  const target =
    settingUp || !first ? (ws.mode === "live" ? `${ws.basePath}/ask` : null) : `${ws.basePath}/${first.id}`;
  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);
  return null;
}

export function SystemRoute({ params }: { params: Params<{ system: string; view?: string[] }> }) {
  const { system, view } = use(params);
  return <SystemPage systemId={system} viewId={view?.[0]} />;
}

export function AskRoute() {
  const ws = useWorkspace();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  if (!canManage(ws.role)) {
    return (
      <ViewEmpty
        title="Only admins can change this workspace"
        description="Ask the owner or an admin of this workspace if something needs to be added or changed."
      />
    );
  }

  if (workspace?.setup) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SetupInterview
          prompt={workspace.setup.prompt}
          attachments={workspace.setup.attachments}
          progress={workspace.setup.progress}
        />
      </div>
    );
  }

  return <AskChat />;
}

export function HistoryRoute() {
  const ws = useWorkspace();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader
        title="History"
        description={`Every change to ${ws.name}, newest first. Undo the latest one at any time.`}
        className="border-b pb-3"
      />
      <HistoryList />
    </div>
  );
}
