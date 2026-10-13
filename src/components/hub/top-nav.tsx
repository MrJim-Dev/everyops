"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/auth/user-menu";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/workspaces", label: "Workspaces", short: "Workspaces" },
  { href: "/community", label: "Community systems", short: "Community" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b bg-shell/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-5 sm:gap-6">
        <Link href="/" className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex flex-1 items-center justify-center gap-1">
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                  "after:absolute after:inset-x-3 after:-bottom-[13px] after:h-px after:bg-primary after:opacity-0 after:transition-opacity after:duration-200",
                  active
                    ? "text-foreground after:opacity-100"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="sm:hidden">{link.short}</span>
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            );
          })}
        </nav>
        <UserMenu variant="topbar" />
      </div>
    </header>
  );
}
