import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WaitlistTable } from "@/components/admin/waitlist-table";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession } from "@/server/session";
import { isSiteAdmin, listWaitlist } from "@/server/waitlist-admin";

export const metadata: Metadata = { title: "Waitlist" };

/** Site admins only (SITE_ADMIN_EMAILS); anyone else gets a plain 404. */
async function Waitlist() {
  const session = await requireSession("/admin/waitlist");
  if (!isSiteAdmin(session.user.email)) notFound();
  return <WaitlistTable entries={await listWaitlist()} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="mt-12 h-64 w-full" />}>
      <Waitlist />
    </Suspense>
  );
}
