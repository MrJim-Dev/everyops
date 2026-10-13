"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { useAuthReady, useCurrentUser } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#systems", label: "Systems" },
  { href: "/community", label: "Community" },
];

/** Transparent over the hero; turns into a frosted bar once the page scrolls. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const ready = useAuthReady();
  const user = useCurrentUser();

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 border-b transition-[background-color,border-color] duration-200",
        scrolled ? "border-border/70 bg-shell/70 backdrop-blur-xl" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-8 px-5">
        <Link href="/" className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-[13.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div
          className={cn(
            "ml-auto flex items-center gap-2 transition-opacity duration-200",
            !ready && "opacity-0",
          )}
        >
          {user ? (
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-primary-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-glow focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
            >
              Open your workspaces
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex h-9 items-center rounded-lg px-3 text-[13.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-[13.5px] font-medium text-shell outline-none transition-[background-color,transform] duration-150 hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
      <span
        aria-hidden="true"
        className="scroll-progress absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-primary/0 via-primary to-glow"
      />
    </header>
  );
}
