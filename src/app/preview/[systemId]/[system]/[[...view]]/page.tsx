import { Suspense } from "react";
import { SystemRoute } from "@/components/routes/workspace-routes";

// Workspace data lives in this browser for now, so these pages render after it loads.
// They can't be prerendered for instant navigation until the data moves to the server.
export const instant = false;

export default function PreviewSystemPage({ params }: PageProps<"/preview/[systemId]/[system]/[[...view]]">) {
  return (
    <Suspense>
      <SystemRoute params={params} />
    </Suspense>
  );
}
