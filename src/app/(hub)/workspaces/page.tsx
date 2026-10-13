import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/auth-guards";
import { RequireSession } from "@/components/auth/require-session";
import { WorkspaceList } from "@/components/hub/workspace-list";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Workspaces" };

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only">Loading</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <div className="flex flex-col gap-8 pt-12">
      <Suspense fallback={<ListSkeleton />}>
        <RequireSession next="/workspaces">
          <RequireAuth fallback={<ListSkeleton />}>
            <WorkspaceList />
          </RequireAuth>
        </RequireSession>
      </Suspense>
    </div>
  );
}
