"use client";

import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/components/workspace/currency";
import { formatMoney } from "@/lib/format";
import type { PublicExtraItem } from "@/lib/public/resolve";

/** Add-ons picked with a quantity (paddle rental, balls), with a running total when they have prices. */
export function ExtrasPicker({
  title,
  items,
  value,
  onChange,
}: {
  title: string;
  items: PublicExtraItem[];
  value: Record<string, number>;
  onChange: (id: string, n: number) => void;
}) {
  const total = items.reduce((sum, i) => sum + (i.price ?? 0) * (value[i.id] ?? 0), 0);
  const currency = useCurrency();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13.5px] font-medium">{title}</legend>
      <ul className="divide-y rounded-md border">
        {items.map((item) => {
          const n = value[item.id] ?? 0;
          return (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2.5 text-[13.5px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.title}</span>
                {item.priceText ? (
                  <span className="text-[12.5px] text-muted-foreground">{item.priceText}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={`One less ${item.title}`}
                  disabled={n === 0}
                  onClick={() => onChange(item.id, Math.max(0, n - 1))}
                >
                  <MinusIcon />
                </Button>
                <span aria-live="polite" className="w-7 text-center font-mono tabular">
                  {n}
                </span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={`One more ${item.title}`}
                  disabled={n >= 50}
                  onClick={() => onChange(item.id, n + 1)}
                >
                  <PlusIcon />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {total > 0 ? (
        <p className="text-right text-[13px] text-muted-foreground">
          Add-ons{" "}
          <span className="font-mono text-foreground tabular">{formatMoney(total, { currency })}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
