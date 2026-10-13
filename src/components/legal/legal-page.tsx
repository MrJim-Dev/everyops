import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Plain reading layout for policy pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-shell">
      <header className="flex h-14 items-center justify-between px-5">
        <Link
          href="/community"
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <nav className="flex gap-4 text-[13px] text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-[680px] animate-rise px-5 pt-12 pb-24">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Last updated {updated}</p>
        <p className="mt-6 rounded-lg border bg-card/40 px-4 py-3 text-[13px] text-muted-foreground">
          Hulma is a prototype built for the Google Cloud AI Builder Cup 2026. This summary will be replaced
          by reviewed terms before Hulma handles real customer data.
        </p>
        <div className="mt-8 flex flex-col gap-4 text-[14.5px] leading-relaxed text-foreground/90 [&_h2]:mt-6 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-foreground">
          {children}
        </div>
      </main>
    </div>
  );
}
