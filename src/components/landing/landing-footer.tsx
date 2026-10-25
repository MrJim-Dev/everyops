import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#how", label: "How it works" },
      { href: "#systems", label: "Systems" },
      { href: "/community", label: "Community" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Get started",
    links: [
      { href: "/sign-up", label: "Create an account" },
      { href: "/sign-in", label: "Sign in" },
      { href: "/preview/court-bookings", label: "Try a live preview" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t bg-shell">
      <div className="mx-auto grid w-full max-w-[1120px] gap-12 px-5 pt-16 pb-10 md:grid-cols-[1.5fr_3fr]">
        <div className="flex max-w-[300px] flex-col gap-4">
          <Logo />
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            Describe your business and EveryOps builds the systems it runs on, in one workspace.
          </p>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[12px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Free while in preview
          </span>
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title} className="flex flex-col gap-3">
              <p className="text-[13px] font-medium">{column.title}</p>
              {column.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="w-fit rounded-sm text-[14px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3 border-t px-5 py-6 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 EveryOps. Built for the Google Cloud AI Builder Cup 2026.</p>
        <a
          href="#top"
          className="w-fit rounded-sm outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Back to top
        </a>
      </div>
      <div aria-hidden="true" className="pointer-events-none select-none overflow-hidden">
        <p className="footer-mark -mb-[0.18em] bg-gradient-to-b from-foreground/[0.13] to-foreground/0 bg-clip-text text-center text-[clamp(88px,21vw,300px)] font-semibold leading-none tracking-[-0.06em] text-transparent">
          EveryOps
        </p>
      </div>
    </footer>
  );
}
