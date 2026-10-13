import type { ReactNode } from "react";
import { requireSession } from "@/server/session";

/**
 * Server-side page protection. Renders its children only for a valid session.
 * Wrap it in <Suspense>: it reads request cookies.
 */
export async function RequireSession({ next, children }: { next: string; children: ReactNode }) {
  await requireSession(next);
  return children;
}
