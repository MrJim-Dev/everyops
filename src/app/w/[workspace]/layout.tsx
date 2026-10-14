import { type ReactNode, Suspense } from "react";
import { RequireSession } from "@/components/auth/require-session";
import { LiveWorkspaceLayout } from "@/components/routes/workspace-routes";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { SidebarPreference } from "@/components/shell/sidebar-preference";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspace]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <WorkspaceSession params={params}>
        <SidebarPreference>
          <LiveWorkspaceLayout params={params}>{children}</LiveWorkspaceLayout>
        </SidebarPreference>
      </WorkspaceSession>
    </Suspense>
  );
}

async function WorkspaceSession({
  params,
  children,
}: {
  params: Promise<{ workspace: string }>;
  children: ReactNode;
}) {
  const { workspace } = await params;
  return <RequireSession next={`/w/${encodeURIComponent(workspace)}`}>{children}</RequireSession>;
}
