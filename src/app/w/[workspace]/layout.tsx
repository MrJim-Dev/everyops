import { Suspense } from "react";
import { LiveWorkspaceLayout } from "@/components/routes/workspace-routes";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspace]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <LiveWorkspaceLayout params={params}>{children}</LiveWorkspaceLayout>
    </Suspense>
  );
}
