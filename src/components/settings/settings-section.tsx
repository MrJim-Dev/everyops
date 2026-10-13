import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One settings block: what it is on the left, the controls on the right. Hairlines between blocks. */
export function SettingsSection({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section className="grid gap-4 border-t py-6 first:border-t-0 md:grid-cols-[220px_1fr] md:gap-10">
      <div className="flex flex-col gap-1">
        <h2 className={cn("text-[14px] font-semibold", tone === "danger" && "text-destructive")}>{title}</h2>
        {description ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[880px] animate-rise flex-col px-5 pb-16">{children}</div>;
}
