import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/auth-guards";
import { RequireSession } from "@/components/auth/require-session";
import { AccountSettings } from "@/components/settings/account-settings";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Account" };

const loading = <Skeleton className="mx-auto mt-12 h-64 w-full max-w-[880px]" />;

export default function AccountPage() {
  return (
    <Suspense fallback={loading}>
      <RequireSession next="/account">
        <RequireAuth fallback={loading}>
          <AccountSettings />
        </RequireAuth>
      </RequireSession>
    </Suspense>
  );
}
