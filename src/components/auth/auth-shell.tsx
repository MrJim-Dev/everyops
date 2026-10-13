import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Quiet, centred frame for every auth page. Content rises in once on load. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-shell">
      <header className="flex h-14 items-center px-5">
        <Link
          href="/community"
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-5 pt-[12vh] pb-16">
        <div className="flex w-full max-w-[360px] flex-col gap-6">
          <div className="flex animate-rise flex-col gap-1.5 text-center">
            <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-[14px] text-muted-foreground">{description}</p> : null}
          </div>
          <div className="animate-rise stagger" style={{ "--i": 1 } as React.CSSProperties}>
            {children}
          </div>
          {footer ? (
            <div
              className="animate-rise stagger text-center text-[13px] text-muted-foreground"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
}
