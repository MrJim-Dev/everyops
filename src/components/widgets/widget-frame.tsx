import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Dashboard section: a title row and content, separated by hairlines rather than cards. */
export function WidgetFrame({
  title,
  aside,
  href,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)}>
      <header className="flex h-11 items-center gap-3 px-5">
        <h2 className="flex-1 truncate text-[13.5px] font-semibold">{title}</h2>
        {aside}
        {href ? (
          <Link
            href={href}
            className="rounded-sm text-[12px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            View all
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}
