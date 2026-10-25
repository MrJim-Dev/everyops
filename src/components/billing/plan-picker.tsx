"use client";

import { CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  formatLimit,
  formatPeso,
  formatStorage,
  type Plan,
  type PlanId,
  PUBLIC_PLANS,
  YEARLY_MONTHS_PAID,
  yearlyCentavos,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export type Period = "monthly" | "yearly";

/** Monthly or yearly, as two buttons. */
export function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-card/40 p-0.5 text-[13px]">
      {(["monthly", "yearly"] as const).map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          onClick={() => onChange(p)}
          className={cn(
            "rounded-md px-3 py-1 transition-colors",
            period === p
              ? "bg-foreground/[0.09] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p === "monthly" ? "Monthly" : `Yearly · ${12 - YEARLY_MONTHS_PAID} months free`}
        </button>
      ))}
    </div>
  );
}

const priceOf = (plan: Plan, period: Period) =>
  period === "yearly" ? yearlyCentavos(plan) : plan.monthlyCentavos;

/**
 * The four plans side by side. On the pricing page each button goes to sign-up (`href`); signed in, it asks for
 * that plan (`onChoose`) and marks the current one.
 */
export function PlanPicker({
  current,
  onChoose,
  busy,
  signUpHref = "/sign-up",
  compact = false,
}: {
  current?: PlanId;
  onChoose?: (plan: PlanId, period: Period) => void;
  busy?: PlanId | null;
  signUpHref?: string;
  compact?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("monthly");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center">
        <PeriodToggle period={period} onChange={setPeriod} />
      </div>
      <div className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
        {PUBLIC_PLANS.map((plan) => {
          const featured = plan.id === "pro";
          const mine = current === plan.id;
          const price = priceOf(plan, period);
          const l = plan.limits;
          return (
            <article
              key={plan.id}
              data-plan={plan.id}
              className={cn(
                "relative flex flex-col gap-4 rounded-xl border bg-card/40 p-5",
                featured
                  ? "border-primary/50 shadow-[0_0_0_1px_var(--color-primary)/0.15]"
                  : "border-foreground/[0.08]",
              )}
            >
              {featured ? (
                <span className="absolute -top-2.5 left-5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                  Most popular
                </span>
              ) : null}
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                <p className="text-[13px] leading-snug text-muted-foreground">{plan.tagline}</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[28px] font-semibold tracking-tight tabular-nums">
                  {formatPeso(price)}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {price ? (period === "yearly" ? "/year" : "/month") : "forever"}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {[
                  `${formatLimit(l.credits)} AI credits a month`,
                  `${formatLimit(l.workspaces)} workspace${l.workspaces === 1 ? "" : "s"}`,
                  `${formatLimit(l.members)} team members each`,
                  `${formatLimit(l.records)} records each`,
                  `${formatStorage(l.storageMb)} of files`,
                  ...plan.highlights,
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" weight="bold" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-1">
                {onChoose ? (
                  <Button
                    className="w-full"
                    variant={featured && !mine ? "default" : "outline"}
                    disabled={mine || !price || busy === plan.id}
                    onClick={() => onChoose(plan.id, period)}
                  >
                    {mine
                      ? "Your plan"
                      : !price
                        ? "Included"
                        : busy === plan.id
                          ? "Sending…"
                          : `Choose ${plan.name}`}
                  </Button>
                ) : (
                  <Link
                    href={price ? `${signUpHref}?plan=${plan.id}` : signUpHref}
                    className={cn(buttonVariants({ variant: featured ? "default" : "outline" }), "w-full")}
                  >
                    {price ? `Start with ${plan.name}` : "Start free"}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
