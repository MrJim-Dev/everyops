import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ApproveFromLink } from "@/components/admin/approve-from-link";
import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { findWaitlisted, readApprovalToken } from "@/server/waitlist-admin";

export const metadata: Metadata = { title: "Approve from the waitlist" };

/** Opened from the approve link in the site admins' email. Approving takes a click, so mail scanners can't. */
async function Approve({ searchParams }: { searchParams: PageProps<"/waitlist/approve">["searchParams"] }) {
  // Links expire, so this reads the clock: per request, never prerendered.
  await connection();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const email = token ? readApprovalToken(token) : null;
  const entry = email ? await findWaitlisted(email) : null;
  if (!email || !entry)
    return (
      <AuthShell
        title="This approve link doesn't work"
        description="It has expired (links last 30 days), was changed, or the person is no longer on the waitlist."
        footer={<AuthLink href="/admin/waitlist">Open the waitlist</AuthLink>}
      >
        <span />
      </AuthShell>
    );
  return <ApproveFromLink token={token} entry={entry} />;
}

export default function Page(props: PageProps<"/waitlist/approve">) {
  return (
    <Suspense>
      <Approve searchParams={props.searchParams} />
    </Suspense>
  );
}
