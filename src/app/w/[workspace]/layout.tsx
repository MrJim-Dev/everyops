import { type ReactNode, Suspense } from "react";
import { RequireSession } from "@/components/auth/require-session";
import { LiveWorkspaceLayout } from "@/components/routes/workspace-routes";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspace]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <WorkspaceSession params={params}>
        <LiveWorkspaceLayout params={params}>{children}</LiveWorkspaceLayout>
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
