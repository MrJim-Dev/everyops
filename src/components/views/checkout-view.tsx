"use client";

import { BarcodeIcon, CheckIcon, MinusIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedValue } from "@/components/motion/animated-value";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { FieldInput } from "@/components/records/field-input";
import { RelationInput } from "@/components/records/relation-input";
import { ScanDialog } from "@/components/scan/scan-dialog";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/components/workspace/currency";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useReportView } from "@/lib/assistant/screen-store";
import { useCurrentUser } from "@/lib/auth/client";
import { findEntity, getEntity, getField, recordsOf, recordTitle } from "@/lib/blueprint/lookup";
import { sameCode, scannableFields } from "@/lib/blueprint/scannable";
import type {
  CheckoutView as CheckoutConfig,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  RecordData,
} from "@/lib/blueprint/types";
import {
  customerFieldOf,
  isCreditMethod,
  lowStockFieldOf,
  missingAnswers,
  paymentChoices,
  priceFieldOf,
  registerDefaults,
  registerFields,
  saleRecords,
  stickyField,
  stockFieldOf,
} from "@/lib/engine/register";
import { currencySymbol, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Receipt, SaleReceipt } from "./sale-receipt";
import { SearchInput } from "./search-input";
import { ViewEmpty } from "./view-empty";

const LOW_STOCK = 5;

/**
 * Register conventions, resolved from the blueprint by field type and name: a product has a price, maybe a
 * stock count (none means it isn't tracked) and a category select. `saleRecords` fills the order and its
 * lines, whatever the generated blueprint called their fields.
 */
function resolve(entity: Entity, type: Field["type"], prefer?: string) {
  return (
    entity.fields.find((f) => f.id === prefer && f.type === type) ??
    entity.fields.find((f) => f.type === type)
  );
}

export function CheckoutView({ view }: { view: CheckoutConfig }) {
  const { blueprint, records, id: workspaceId, name: workspaceName, mode } = useWorkspace();
  const currency = useCurrency();
  const actions = useRecordActions();
  const user = useCurrentUser();
  const product = getEntity(blueprint, view.productEntityId);
  const line = getEntity(blueprint, view.lineEntityId);
  const order = getEntity(blueprint, view.entityId);
  const priceField = priceFieldOf(product);
  const stockField = stockFieldOf(product);
  const categoryField = resolve(product, "select", "category");
  const lineProduct = line.fields.find((f) => f.type === "relation" && f.relation?.entityId === product.id);
  const payment = getField(order, view.paymentFieldId);
  const orderStatus = order.fields.find((f) => f.type === "status");
  const lowStockField = lowStockFieldOf(product);
  const customerField = customerFieldOf(order, product.id);
  const codes = useMemo(() => scannableFields(product), [product]);

  const [query, setQuery] = useState("");
  useReportView({ viewId: view.id, search: query.trim() || undefined });
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<{ productId: string; qty: number }[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // The order being rung up survives a reload in this tab (sessionStorage, never the workspace's data).
  const cartKey = `everyops:cart:${workspaceId}:${view.id}`;
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || mode !== "live") return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(cartKey) ?? "[]");
      if (Array.isArray(saved) && saved.length) setCart(saved);
    } catch {}
  }, [cartKey, mode]);
  useEffect(() => {
    if (!restored.current) return;
    if (cart.length) sessionStorage.setItem(cartKey, JSON.stringify(cart));
    else sessionStorage.removeItem(cartKey);
  }, [cart, cartKey]);
  const methods = paymentChoices(
    payment,
    records,
    payment.relation ? findEntity(blueprint, payment.relation.entityId) : undefined,
  );
  const [picked, setMethod] = useState("");
  // Linked payment methods load with the records, so fall back to the first one until the cashier picks.
  const method = methods.some((m) => m.id === picked) ? picked : (methods[0]?.id ?? "");
  const [cash, setCash] = useState("");
  const orderRef = useRef<HTMLElement>(null);
  const [justSold, setJustSold] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);

  // Everything else the sale needs (a branch, a table, a shift), read from the blueprint. Branch-like answers
  // stick to this register between sales and reloads; a field with only one possible choice is pre-picked.
  const asked = useMemo(() => registerFields(blueprint, view), [blueprint, view]);
  const answersKey = `everyops:register:${workspaceId}:${view.id}`;
  const [saved, setSaved] = useState<RecordData>({});
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(answersKey) ?? "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) setSaved(stored);
    } catch {}
  }, [answersKey]);
  const [typed, setTyped] = useState<RecordData>({});
  const answers = useMemo(
    () => ({ ...registerDefaults(asked, records, saved), ...typed }),
    [asked, records, saved, typed],
  );
  const missing = missingAnswers(asked, answers);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const answer = (field: Field, value: FieldValue) => {
    setTyped((t) => ({ ...t, [field.id]: value }));
    setFieldErrors(({ [field.id]: _, ...rest }) => rest);
    if (!stickyField(field)) return;
    setSaved((s) => {
      const next = { ...s, [field.id]: value };
      try {
        localStorage.setItem(answersKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const products = useMemo(
    () =>
      recordsOf(records, product.id)
        .filter((p) => category === "all" || p.data[categoryField?.id ?? ""] === category)
        .filter((p) => {
          const q = query.trim().toLowerCase();
          return (
            recordTitle(product, p).toLowerCase().includes(q) ||
            codes.some((f) =>
              String(p.data[f.id] ?? "")
                .toLowerCase()
                .includes(q),
            )
          );
        }),
    [records, product, category, categoryField, query, codes],
  );
  const byId = (id: string) => records.find((r) => r.id === id);
  const price = (p: DataRecord | undefined) => Number(p?.data[priceField?.id ?? ""] ?? 0);
  // Products without a stock count aren't tracked, so they never sell out.
  const stock = (p: DataRecord | undefined) =>
    stockField ? Number(p?.data[stockField.id] ?? 0) : Number.POSITIVE_INFINITY;
  const total = cart.reduce((sum, item) => sum + price(byId(item.productId)) * item.qty, 0);
  const cashValue = Number(cash) || 0;
  const methodLabel = methods.find((m) => m.id === method)?.label ?? "";
  const isCash = method === "cash" || /\bcash\b/i.test(methodLabel);
  const shortBy = isCash && cash !== "" ? total - cashValue : 0;
  const credit = isCreditMethod(`${method} ${methodLabel}`);
  const needsCustomer = (credit || !!customerField?.required) && !!customerField && !customer;
  const lowAt = (p: DataRecord) => Number(p.data[lowStockField?.id ?? ""]) || LOW_STOCK;

  const add = (productId: string) =>
    setCart((c) => {
      const existing = c.find((i) => i.productId === productId);
      const max = stock(byId(productId));
      if (existing)
        return c.map((i) => (i.productId === productId ? { ...i, qty: Math.min(max, i.qty + 1) } : i));
      return [...c, { productId, qty: 1 }];
    });
  // Products with a code (Barcode, SKU) go into the sale when it's scanned, by camera or a handheld scanner.
  const [scanning, setScanning] = useState(false);
  const addByCode = (code: string, quiet = false): boolean => {
    const found = recordsOf(records, product.id).find((p) => codes.some((f) => sameCode(p.data[f.id], code)));
    if (!found) {
      if (!quiet) toast.error(`No product with ${codes[0]?.name.toLowerCase() ?? "code"} ${code.trim()}`);
      return false;
    }
    const inCart = cart.find((i) => i.productId === found.id)?.qty ?? 0;
    if (stock(found) - inCart <= 0) {
      toast.error(`${recordTitle(product, found)} is sold out`);
      return true;
    }
    add(found.id);
    toast.success(`Added ${recordTitle(product, found)}`);
    return true;
  };
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

  const complete = (status: "completed" | "held") => {
    if (!lineProduct) return;
    const code = nextCode();
    const items = cart.flatMap((item) => {
      const p = byId(item.productId);
      return p ? [{ product: p, qty: item.qty }] : [];
    });
    const sale = saleRecords({
      product,
      order,
      line,
      paymentFieldId: payment.id,
      items,
      code,
      method,
      // A blank amount means the customer paid exactly.
      cash: status === "held" || !isCash ? undefined : cash === "" ? total : cashValue,
      status,
      cashier: user?.name || user?.email,
      customer: customer ?? undefined,
      answers,
    });
    const result = actions.createWithLines(order.id, sale.order, line.id, sale.lines);
    if (!result.ok) {
      const shown = new Set(asked.map((a) => a.field.id));
      setFieldErrors(
        Object.fromEntries(
          result.errors.flatMap((e) => (e.fieldId && shown.has(e.fieldId) ? [[e.fieldId, e.message]] : [])),
        ),
      );
      const first = result.errors[0]?.message;
      const unasked = result.errors.some((e) => !e.fieldId || !shown.has(e.fieldId));
      toast.error(first ?? "The sale could not be saved", {
        description:
          unasked && first?.endsWith("is required")
            ? "This field belongs to the order lines. Ask the assistant to give it a default or make it optional."
            : undefined,
      });
      return;
    }
    if (status === "held") toast.success(`Order ${code} held`);
    else {
      const buyer = customer ? records.find((r) => r.id === customer) : undefined;
      const buyerEntity = customerField?.relation
        ? findEntity(blueprint, customerField.relation.entityId)
        : undefined;
      setReceipt({
        business: workspaceName,
        code,
        at: new Date(),
        items: items.map((i) => ({
          name: recordTitle(product, i.product),
          qty: i.qty,
          unit: price(i.product),
        })),
        total,
        method: methodLabel || "Paid",
        cash: isCash ? (cash === "" ? total : cashValue) : undefined,
        cashier: user?.name || user?.email,
        customer: buyer && buyerEntity ? recordTitle(buyerEntity, buyer) : undefined,
      });
    }
    setCart([]);
    setCash("");
    setCustomer(null);
    // The branch stays picked for the next sale; one-off answers (a note) start empty again.
    setTyped((t) =>
      Object.fromEntries(
        Object.entries(t).filter(([id]) => asked.some((a) => a.field.id === id && stickyField(a.field))),
      ),
    );
    setFieldErrors({});
    if (status !== "held") {
      setJustSold(code);
      setTimeout(() => setJustSold(null), 1400);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_380px] lg:overflow-hidden">
      <section aria-label="Products" className="flex flex-col lg:min-h-0">
        <div className="flex flex-col gap-3 border-b px-5 py-3">
          {/* A handheld scanner types the code and presses Enter here; the product goes into the sale. */}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (codes.length && query.trim() && addByCode(query, true)) setQuery("");
            }}
          >
            <div className="min-w-0 flex-1 sm:flex-none">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={codes.length ? "Search or scan products" : "Search products"}
              />
            </div>
            {codes.length ? (
              <Button type="button" variant="outline" onClick={() => setScanning(true)}>
                <BarcodeIcon data-icon="inline-start" />
                Scan
              </Button>
            ) : null}
          </form>
          {codes.length ? (
            <ScanDialog
              open={scanning}
              onOpenChange={setScanning}
              title="Scan a product"
              description={`Scan its ${codes[0].name.toLowerCase()} to add it to the sale.`}
              onScan={(code) => addByCode(code)}
            />
          ) : null}
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
                      {formatMoney(price(p), { currency })}
                    </span>
                  </span>
                  {left === 0 ? (
                    <span className="text-[12px] text-muted-foreground">Sold out</span>
                  ) : left <= lowAt(p) ? (
                    <span className="text-[12px] text-warning">{left} left</span>
                  ) : stockField ? (
                    <span className="font-mono text-[12px] text-muted-foreground tabular">
                      {left} in stock
                    </span>
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
                        {formatMoney(price(p), { currency })}
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
                      {formatMoney(price(p) * item.qty, { currency })}
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
              value={formatMoney(total, { currency })}
              className="font-mono text-[22px] font-semibold tabular"
            />
          </div>
          {asked.map(({ field, on }) => {
            const id = `sale-${on}-${field.id}`;
            const error = fieldErrors[field.id];
            const needed = cart.length > 0 && missing.includes(field);
            return (
              <div key={id} className="flex flex-col gap-2">
                <Label htmlFor={id} className="text-[12px] text-muted-foreground">
                  {field.name}
                  {field.required ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      *
                    </span>
                  ) : null}
                </Label>
                <FieldInput
                  id={id}
                  field={field}
                  value={answers[field.id]}
                  invalid={!!error || needed}
                  onChange={(v) => answer(field, v)}
                />
                {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
              </div>
            );
          })}
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-muted-foreground">Payment method</span>
            <SegmentedControl
              label="Payment method"
              variant="boxed"
              value={method}
              onValueChange={setMethod}
              options={methods.map((o) => ({ value: o.id, label: o.label }))}
            />
          </div>
          {customerField ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="sale-customer" className="text-[12px] text-muted-foreground">
                {customerField.name}
                {credit ? <span className="text-warning">· needed for {methodLabel}</span> : null}
              </Label>
              <RelationInput
                id="sale-customer"
                field={customerField}
                value={customer}
                onChange={setCustomer}
                invalid={needsCustomer && cart.length > 0}
              />
            </div>
          ) : null}
          {isCash ? (
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="cash-received" className="text-[12px] text-muted-foreground">
                  Cash received
                </Label>
                <InputGroup className="h-9">
                  <InputGroupAddon>
                    <InputGroupText>{currencySymbol(currency)}</InputGroupText>
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
                  {shortBy > 0 ? "Still due" : cash === "" ? "Exact amount" : "Change due"}
                </span>
                <span
                  className={cn("font-mono text-[15px] font-medium tabular", shortBy > 0 && "text-warning")}
                >
                  {formatMoney(shortBy > 0 ? shortBy : Math.max(0, cashValue - total), { currency })}
                </span>
              </div>
            </div>
          ) : null}
          <Button
            size="lg"
            disabled={cart.length === 0 || shortBy > 0 || needsCustomer || missing.length > 0 || !!justSold}
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
                <>Complete sale · {formatMoney(total, { currency })}</>
              )}
            </span>
          </Button>
          {orderStatus?.options?.some((o) => o.id === "held") ? (
            <Button
              variant="outline"
              disabled={cart.length === 0 || missing.length > 0}
              onClick={() => complete("held")}
            >
              Hold order
            </Button>
          ) : null}
          {cart.length > 0 && missing.length > 0 ? (
            <p aria-live="polite" className="text-center text-[12px] text-muted-foreground">
              Choose {missing.map((f) => f.name.toLowerCase()).join(", ")} to complete the sale.
            </p>
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
            Review order · {formatMoney(total, { currency })}
          </Button>
        </div>
      ) : null}
      <SaleReceipt receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
