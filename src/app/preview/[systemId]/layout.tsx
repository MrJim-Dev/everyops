import { Suspense } from "react";
import { PreviewWorkspaceLayout } from "@/components/routes/workspace-routes";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { SidebarPreference } from "@/components/shell/sidebar-preference";

export default function PreviewLayout({ children, params }: LayoutProps<"/preview/[systemId]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <SidebarPreference>
        <PreviewWorkspaceLayout params={params}>{children}</PreviewWorkspaceLayout>
      </SidebarPreference>
    </Suspense>
  );
}
