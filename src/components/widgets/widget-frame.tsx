import Link from "next/link";
import type { ReactNode } from "react";
import type { WidgetLook } from "@/lib/engine/widget-look";
import { cn } from "@/lib/utils";
import { LookBadge } from "./widget-look";

/** Dashboard section: a title row (with the widget's icon in its colour) and content, separated by hairlines. */
export function WidgetFrame({
  title,
  look,
  aside,
  href,
  children,
  className,
}: {
  title: string;
  look?: WidgetLook;
  aside?: ReactNode;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)}>
      <header className={cn("flex items-center gap-3 px-5", look ? "h-14" : "h-11")}>
        {look ? <LookBadge look={look} /> : null}
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
