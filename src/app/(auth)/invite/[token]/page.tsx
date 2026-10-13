import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInvite } from "@/components/team/accept-invite";

export const metadata: Metadata = { title: "Join workspace" };

export default function Page({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense>
      <AcceptInvite params={params} />
    </Suspense>
  );
}
