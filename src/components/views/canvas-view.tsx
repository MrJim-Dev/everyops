"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { CanvasView as CanvasConfig } from "@/lib/blueprint/types";

// Konva draws on a real <canvas>, so the editor loads in the browser only.
const CanvasEditor = dynamic(() => import("@/components/canvas/canvas-editor").then((m) => m.CanvasEditor), {
  ssr: false,
  loading: () => <Skeleton className="m-4 flex-1 rounded-lg" />,
});

/** A free canvas page: shapes, text, sticky notes, arrows and pictures, saved with the workspace. */
export function CanvasView({ view }: { view: CanvasConfig }) {
  return <CanvasEditor key={view.id} viewId={view.id} name={view.name} />;
}
