"use client";

import { CheckIcon, MinusIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedValue } from "@/components/motion/animated-value";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, recordsOf, recordTitle } from "@/lib/blueprint/lookup";
import type { CheckoutView as CheckoutConfig, DataRecord, Entity, Field } from "@/lib/blueprint/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SearchInput } from "./search-input";
import { ViewEmpty } from "./view-empty";

const LOW_STOCK = 5;

/**
 * Register conventions, resolved from the blueprint by field type: a product
 * has one money field (price), one number field (stock) and one select
 * (category). Lines link to a product and store qty and price.
 */
function resolve(entity: Entity, type: Field["type"], prefer?: string) {
  return (
    entity.fields.find((f) => f.id === prefer && f.type === type) ??
    entity.fields.find((f) => f.type === type)
  );
}

export function CheckoutView({ view }: { view: CheckoutConfig }) {
  const { blueprint, records } = useWorkspace();
  const actions = useRecordActions();
  const product = getEntity(blueprint, view.productEntityId);
  const line = getEntity(blueprint, view.lineEntityId);
  const order = getEntity(blueprint, view.entityId);
  const priceField = resolve(product, "money", "price");
  const stockField = resolve(product, "number", "stock");
  const categoryField = resolve(product, "select", "category");
  const lineProduct = line.fields.find((f) => f.type === "relation" && f.relation?.entityId === product.id);
  const payment = getField(order, view.paymentFieldId);
  const placedAt = resolve(order, "datetime");
  const orderStatus = order.fields.find((f) => f.type === "status");
  const cashField = order.fields.find((f) => f.id === "cash_received");

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<{ productId: string; qty: number }[]>([]);
  const [method, setMethod] = useState(payment.options?.[0]?.id ?? "cash");
  const [cash, setCash] = useState("");
  const orderRef = useRef<HTMLElement>(null);
  const [justSold, setJustSold] = useState<string | null>(null);

  const products = useMemo(
    () =>
      recordsOf(records, product.id)
        .filter((p) => category === "all" || p.data[categoryField?.id ?? ""] === category)
        .filter((p) => recordTitle(product, p).toLowerCase().includes(query.trim().toLowerCase())),
    [records, product, category, categoryField, query],
  );
  const byId = (id: string) => records.find((r) => r.id === id);
  const price = (p: DataRecord | undefined) => Number(p?.data[priceField?.id ?? ""] ?? 0);
  const stock = (p: DataRecord | undefined) => Number(p?.data[stockField?.id ?? ""] ?? 0);
  const total = cart.reduce((sum, item) => sum + price(byId(item.productId)) * item.qty, 0);
  const cashValue = Number(cash) || 0;
  const isCash = method === "cash";
  const shortBy = isCash && cash !== "" ? total - cashValue : 0;

  const add = (productId: string) =>
    setCart((c) => {
      const existing = c.find((i) => i.productId === productId);
      const max = stock(byId(productId));
      if (existing)
        return c.map((i) => (i.productId === productId ? { ...i, qty: Math.min(max, i.qty + 1) } : i));
      return [...c, { productId, qty: 1 }];
    });
  const setQty = (productId: string, qty: number) =>
    setCart((c) =>
      qty <= 0
        ? c.filter((i) => i.productId !== productId)
        : c.map((i) =>
            i.productId === productId ? { ...i, qty: Math.min(stock(byId(productId)), qty) } : i,
          ),
    );

  const nextCode = () => {
    const codes = recordsOf(records, order.id).map(
      (o) => Number(String(o.data[order.primaryFieldId] ?? "").replace(/\D/g, "")) || 0,
    );
    return `#${Math.max(1000, ...codes) + 1}`;
  };

  const complete = (statusId: string | undefined) => {
    if (!lineProduct) return;
    const code = nextCode();
    const result = actions.createWithLines(
      order.id,
      {
        [order.primaryFieldId]: code,
        ...(placedAt ? { [placedAt.id]: new Date().toISOString() } : {}),
        [payment.id]: method,
        ...(orderStatus && statusId ? { [orderStatus.id]: statusId } : {}),
        ...(cashField && isCash && cashValue ? { [cashField.id]: cashValue } : {}),
      },
      line.id,
      cart.map((item) => ({
        [lineProduct.id]: item.productId,
        qty: item.qty,
        price: price(byId(item.productId)),
      })),
    );
    if (!result.ok) {
      toast.error(result.errors[0]?.message ?? "The sale could not be saved");
      return;
    }
    toast.success(
      statusId === "held" ? `Order ${code} held` : `Sale ${code} completed · ${formatMoney(total)}`,
    );
    setCart([]);
    setCash("");
    if (statusId !== "held") {
      setJustSold(code);
      setTimeout(() => setJustSold(null), 1400);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_380px] lg:overflow-hidden">
      <section aria-label="Products" className="flex flex-col lg:min-h-0">
        <div className="flex flex-col gap-3 border-b px-5 py-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search products" />
          {categoryField?.options ? (
            <SegmentedControl
              label="Category"
              value={category}
              onValueChange={setCategory}
              options={[
                { value: "all", label: "All" },
                ...categoryField.options.map((o) => ({ value: o.id, label: o.label })),
              ]}
            />
          ) : null}
        </div>
        <ul className="divide-y lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {products.map((p) => {
            const left = stock(p);
            const inCart = cart.find((i) => i.productId === p.id)?.qty ?? 0;
            const soldOut = left - inCart <= 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={soldOut}
                  onClick={() => add(p.id)}
                  className="group flex h-14 w-full items-center gap-4 px-5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">
                      {recordTitle(product, p)}
                    </span>
                    <span className="block font-mono text-[12px] text-muted-foreground tabular">
                      {formatMoney(price(p))}
                    </span>
                  </span>
                  {left === 0 ? (
                    <span className="text-[12px] text-muted-foreground">Sold out</span>
                  ) : left <= LOW_STOCK ? (
                    <span className="text-[12px] text-warning">{left} left</span>
                  ) : null}
                  {inCart ? (
                    <span key={inCart} className="animate-pop font-mono text-[12px] text-primary tabular">
                      ×{inCart}
                    </span>
                  ) : null}
                  <span className="flex size-9 items-center justify-center rounded-md border transition-[transform,background-color] duration-150 ease-out group-hover:bg-muted group-active:scale-90">
                    <PlusIcon className="size-4" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {products.length === 0 ? (
          <ViewEmpty title="No products found" description="Try another search or category." />
        ) : null}
      </section>

      <section
        ref={orderRef}
        aria-label="Current order"
        className="flex flex-col border-t bg-card/40 lg:min-h-0 lg:border-t-0 lg:border-l"
      >
        <header className="flex h-12 items-center justify-between border-b px-5">
          <h2 className="text-[14px] font-semibold">Current order</h2>
          <span className="font-mono text-[12px] text-muted-foreground tabular">{nextCode()}</span>
        </header>

        <div className="px-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {cart.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Tap a product to add it to the order.
            </p>
          ) : (
            <ul className="divide-y">
              {cart.map((item) => {
                const p = byId(item.productId);
                return (
                  <li key={item.productId} className="enter-right flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {p ? recordTitle(product, p) : "Removed"}
                      </span>
                      <span className="block font-mono text-[11.5px] text-muted-foreground tabular">
                        {formatMoney(price(p))}
                      </span>
                    </span>
                    <div className="flex items-center rounded-md border">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Decrease quantity"
                        onClick={() => setQty(item.productId, item.qty - 1)}
                      >
                        <MinusIcon />
                      </Button>
                      <span className="w-7 text-center font-mono text-[13px] tabular">{item.qty}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Increase quantity"
                        onClick={() => setQty(item.productId, item.qty + 1)}
                      >
                        <PlusIcon />
                      </Button>
                    </div>
                    <span className="w-16 text-right font-mono text-[13px] tabular">
                      {formatMoney(price(p) * item.qty)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove item"
                      onClick={() => setQty(item.productId, 0)}
                    >
                      <XIcon />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-muted-foreground">Total</span>
            <AnimatedValue
              value={formatMoney(total)}
              className="font-mono text-[22px] font-semibold tabular"
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-muted-foreground">Payment method</span>
            <SegmentedControl
              label="Payment method"
              variant="boxed"
              value={method}
              onValueChange={setMethod}
              options={(payment.options ?? []).map((o) => ({ value: o.id, label: o.label }))}
            />
          </div>
          {isCash ? (
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="cash-received" className="text-[12px] text-muted-foreground">
                  Cash received
                </Label>
                <InputGroup className="h-9">
                  <InputGroupAddon>
                    <InputGroupText>₱</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="cash-received"
                    inputMode="decimal"
                    type="number"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="0"
                  />
                </InputGroup>
              </div>
              <div className="flex h-9 flex-col justify-center text-right">
                <span className="text-[11px] text-muted-foreground">
                  {shortBy > 0 ? "Still due" : "Change due"}
                </span>
                <span
                  className={cn("font-mono text-[15px] font-medium tabular", shortBy > 0 && "text-warning")}
                >
                  {formatMoney(shortBy > 0 ? shortBy : Math.max(0, cashValue - total))}
                </span>
              </div>
            </div>
          ) : null}
          <Button
            size="lg"
            disabled={cart.length === 0 || shortBy > 0 || !!justSold}
            onClick={() => complete("completed")}
            className={cn("h-11 text-[14px]", justSold && "disabled:opacity-100")}
          >
            <span
              key={justSold ?? "idle"}
              className={cn("inline-flex items-center gap-1.5", justSold && "animate-swap")}
            >
              {justSold ? (
                <>
                  <CheckIcon data-icon="inline-start" />
                  Sale {justSold} completed
                </>
              ) : (
                <>Complete sale · {formatMoney(total)}</>
              )}
            </span>
          </Button>
          {orderStatus?.options?.some((o) => o.id === "held") ? (
            <Button variant="outline" disabled={cart.length === 0} onClick={() => complete("held")}>
              Hold order
            </Button>
          ) : null}
        </div>
      </section>

      {/* Phones: the order sits below the products, so keep the total one tap away. */}
      {cart.length ? (
        <div className="enter-bottom sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur-sm lg:hidden">
          <Button
            size="lg"
            className="h-11 w-full text-[14px]"
            onClick={() => orderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Review order · {formatMoney(total)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
