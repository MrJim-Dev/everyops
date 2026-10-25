import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccountsTable } from "@/components/admin/accounts-table";
import { Skeleton } from "@/components/ui/skeleton";
import { listAccounts, spendOverview } from "@/server/billing/account";
import { requireSession } from "@/server/session";
import { isSiteAdmin } from "@/server/waitlist-admin";

export const metadata: Metadata = { title: "Accounts" };

/** Site admins only: every account's plan and use, today's AI spending and the safety switch. */
async function Accounts() {
  const session = await requireSession("/admin/accounts");
  if (!isSiteAdmin(session.user.email)) notFound();
  const [accounts, spend] = await Promise.all([listAccounts(), spendOverview()]);
  return <AccountsTable accounts={accounts} spend={spend} />;
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="mt-12 h-64 w-full" />}>
      <Accounts />
    </Suspense>
  );
}
