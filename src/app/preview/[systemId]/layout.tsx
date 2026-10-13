import { Suspense } from "react";
import { PreviewWorkspaceLayout } from "@/components/routes/workspace-routes";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";

export default function PreviewLayout({ children, params }: LayoutProps<"/preview/[systemId]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <PreviewWorkspaceLayout params={params}>{children}</PreviewWorkspaceLayout>
    </Suspense>
  );
}
