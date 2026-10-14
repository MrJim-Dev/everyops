"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UserMenu } from "@/components/auth/user-menu";
import { Logo } from "@/components/brand/logo";
import { useAuthReady, useCurrentUser } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; short?: string };

/** Where a signed-in person goes, from any page. */
const APP_LINKS: NavLink[] = [
  { href: "/workspaces", label: "Workspaces" },
  { href: "/community", label: "Community systems", short: "Community" },
];
/** The landing page's sections, for visitors who aren't signed in. */
const LANDING_LINKS: NavLink[] = [
  { href: "#how", label: "How it works" },
  { href: "#systems", label: "Systems" },
  { href: "/community", label: "Community" },
];

const linkClass =
  "relative rounded-md px-3 py-1.5 text-[13.5px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * The one top bar for the site: the same height, width and order on the landing page and in the app, so the logo,
 * links and account never move between pages. Signed in, it's always Workspaces, Community systems and your account;
 * signed out, the landing page's sections with Sign in and Get started. On the landing page it sits over the hero
 * and frosts once the page scrolls; in the app and on other public pages ("page", e.g. Terms) it's always frosted.
 */
export function SiteNav({ variant }: { variant: "landing" | "app" | "page" }) {
  const pathname = usePathname();
  const ready = useAuthReady();
  const user = useCurrentUser();
  const landing = variant === "landing";
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!landing) return;
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [landing]);

  // App pages are signed in by definition; elsewhere the links wait for the session so they don't swap.
  const app = variant === "app";
  const signedIn = app || !!user;
  const settled = app || ready;
  // Off the landing page its section links lead back to it ("/" is the landing page for visitors).
  const links = signedIn
    ? APP_LINKS
    : LANDING_LINKS.map((l) => (l.href.startsWith("#") && !landing ? { ...l, href: `/${l.href}` } : l));

  return (
    <header
      className={cn(
        "inset-x-0 top-0 border-b",
        landing
          ? cn(
              "fixed z-40 transition-[background-color,border-color] duration-200",
              scrolled ? "border-border/70 bg-shell/70 backdrop-blur-xl" : "border-transparent",
            )
          : "sticky z-30 bg-shell/75 backdrop-blur-xl",
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-3 px-5 sm:gap-6">
        <Link
          href="/"
          className="shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <nav
          aria-label="Main"
          className={cn(
            "flex min-w-0 items-center gap-1 transition-opacity duration-200",
            !signedIn && "hidden md:flex",
            !settled && "opacity-0",
          )}
        >
          {links.map((link) => {
            const active = !link.href.startsWith("#") && pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  linkClass,
                  "after:absolute after:inset-x-3 after:-bottom-[13px] after:h-px after:bg-primary after:opacity-0 after:transition-opacity after:duration-200",
                  active
                    ? "text-foreground after:opacity-100"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.short ? (
                  <>
                    <span className="sm:hidden">{link.short}</span>
                    <span className="hidden sm:inline">{link.label}</span>
                  </>
                ) : (
                  link.label
                )}
              </Link>
            );
          })}
        </nav>
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-2 transition-opacity duration-200",
            !settled && "opacity-0",
          )}
        >
          {signedIn ? (
            <UserMenu variant="topbar" />
          ) : (
            <>
              <Link href="/sign-in" className={cn(linkClass, "text-muted-foreground hover:text-foreground")}>
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-8 items-center rounded-lg bg-foreground px-3.5 text-[13.5px] font-medium text-shell outline-none transition-[background-color,transform] duration-150 hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
      {landing ? (
        <span
          aria-hidden="true"
          className="scroll-progress absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-primary/0 via-primary to-glow"
        />
      ) : null}
    </header>
  );
}
