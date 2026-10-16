import type { Metadata } from "next";
import { Suspense } from "react";
import { ManageBooking } from "@/components/public/manage-booking";
import { managedBooking } from "@/server/manage";

export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

/** A visitor's own booking, from the link they got when they booked. No account needed. */
export default function Page({ params }: PageProps<"/b/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-shell" />}>
      <Booking params={params} />
    </Suspense>
  );
}

async function Booking({ params }: { params: PageProps<"/b/[token]">["params"] }) {
  const { token } = await params;
  const booking = await managedBooking(token);
  return <ManageBooking token={token} initial={booking.ok ? booking : null} />;
}
