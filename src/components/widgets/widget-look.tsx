"use client";

import {
  CalendarCheckIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  ClockIcon,
  CoinsIcon,
  HashIcon,
  type Icon,
  PackageIcon,
  PercentIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  StarIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { type LookIcon, TONE_COLOR, type WidgetLook } from "@/lib/engine/widget-look";
import { cn } from "@/lib/utils";

const ICONS: Record<LookIcon, Icon> = {
  money: CoinsIcon,
  alert: WarningCircleIcon,
  expense: ReceiptIcon,
  calendar: CalendarCheckIcon,
  people: UsersThreeIcon,
  orders: ShoppingBagIcon,
  stock: PackageIcon,
  percent: PercentIcon,
  clock: ClockIcon,
  check: CheckCircleIcon,
  star: StarIcon,
  trend: ChartLineUpIcon,
  count: HashIcon,
};

/** The tone as CSS variables a widget's pieces read: --tone for strokes and text, --tone-soft for tinted wells. */
export function toneStyle(look: WidgetLook): CSSProperties {
  const color = TONE_COLOR[look.tone];
  return {
    "--tone": color,
    "--tone-soft": `color-mix(in oklab, ${color} 16%, transparent)`,
  } as CSSProperties;
}

/** A widget's icon in a tinted rounded square. */
export function LookBadge({ look, className }: { look: WidgetLook; className?: string }) {
  const Glyph = ICONS[look.icon];
  return (
    <span
      aria-hidden="true"
      style={toneStyle(look)}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--tone-soft) text-(--tone)",
        className,
      )}
    >
      <Glyph weight="duotone" className="size-4" />
    </span>
  );
}
