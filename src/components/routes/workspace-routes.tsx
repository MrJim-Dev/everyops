"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, use, useEffect } from "react";
import { ChangePlanner } from "@/components/changes/change-planner";
import { HistoryList } from "@/components/changes/history-list";
import { SetupInterview } from "@/components/setup/setup-interview";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { SystemPage } from "@/components/system/system-page";
import { LiveWorkspace } from "@/components/workspace/live-workspace";
import { PreviewWorkspace } from "@/components/workspace/preview-workspace";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useWorkspaces } from "@/lib/store/workspaces";

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
    <LiveWorkspace slug={workspace}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </LiveWorkspace>
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

/** /w/[workspace] and /preview/[id]: go to Ask Hulma during setup, otherwise the first system. */
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
  const changes = workspace?.changes ?? [];

  if (workspace?.setup) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Ask Hulma" description="Set up your workspace" className="border-b pb-3" />
        <SetupInterview prompt={workspace.setup.prompt} progress={workspace.setup.progress} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader
        title="Ask Hulma"
        description={`Change ${ws.name} in your own words.`}
        className="border-b pb-3"
      />
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-10 px-5 py-8">
        <ChangePlanner />
        {changes.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold">Recent changes</h2>
            <ul className="divide-y rounded-lg border text-[13px]">
              {changes.slice(0, 3).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">v{c.toVersion}</span>
                  {c.undoneAt ? <span className="text-[12px] text-muted-foreground">Undone</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function HistoryRoute() {
  const ws = useWorkspace();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader
        title="History"
        description={`Every version of ${ws.name}. Undo the latest change at any time.`}
        className="border-b pb-3"
      />
      <HistoryList />
    </div>
  );
}
