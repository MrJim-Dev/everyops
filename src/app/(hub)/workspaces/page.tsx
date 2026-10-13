import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/auth-guards";
import { RequireSession } from "@/components/auth/require-session";
import { GridSkeleton, WorkspaceList } from "@/components/hub/workspace-list";

export const metadata: Metadata = { title: "Workspaces" };

export default function WorkspacesPage() {
  return (
    <div className="flex flex-col gap-8 pt-12">
      <Suspense fallback={<GridSkeleton />}>
        <RequireSession next="/workspaces">
          <RequireAuth fallback={<GridSkeleton />}>
            <WorkspaceList />
          </RequireAuth>
        </RequireSession>
      </Suspense>
    </div>
  );
}
