import type { Metadata } from "next";
import { RequireAuth } from "@/components/auth/auth-guards";
import { AccountSettings } from "@/components/settings/account-settings";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <RequireAuth fallback={<Skeleton className="mx-auto mt-12 h-64 w-full max-w-[880px]" />}>
      <AccountSettings />
    </RequireAuth>
  );
}
