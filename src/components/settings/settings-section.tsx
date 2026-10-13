import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One settings card: title and description, the controls, and an optional footer bar that holds
 * a short note on the left and the card's action on the right.
 */
export function SettingsSection({
  title,
  description,
  children,
  footer,
  action,
  tone = "default",
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** A short note in the footer bar, e.g. what saving does. */
  footer?: ReactNode;
  /** The card's primary action, right-aligned in the footer bar. */
  action?: ReactNode;
  tone?: "default" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card/40",
        danger ? "border-destructive/30" : "border-foreground/[0.08]",
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description ? (
            <p className="max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {children ? <div className="flex min-w-0 flex-col gap-4">{children}</div> : null}
      </div>
      {footer || action ? (
        <div
          className={cn(
            "flex min-h-12 flex-wrap items-center justify-between gap-3 border-t px-5 py-2.5",
            danger
              ? "border-destructive/20 bg-destructive/[0.04]"
              : "border-foreground/[0.06] bg-foreground/[0.02]",
          )}
        >
          <div className="text-[12.5px] text-muted-foreground">{footer}</div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

/** The column of cards. Cards rise in one after another the first time a settings page opens. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className="stagger-children flex w-full max-w-[1120px] flex-col gap-4 pb-10">{children}</div>;
}
