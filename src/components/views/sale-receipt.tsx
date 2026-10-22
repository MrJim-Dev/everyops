"use client";

import { PrinterIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrency } from "@/components/workspace/currency";
import { formatMoney } from "@/lib/format";
import { zone } from "@/lib/time";

export type Receipt = {
  business: string;
  code: string;
  at: Date;
  items: { name: string; qty: number; unit: number }[];
  total: number;
  method: string;
  cash?: number;
  cashier?: string;
  customer?: string;
};

const htmlText = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const when = (d: Date) =>
  d.toLocaleString("en-PH", { timeZone: zone(), dateStyle: "medium", timeStyle: "short" });

/** A receipt as a small standalone page, sized for 58–80 mm thermal printers. */
function receiptHtml(r: Receipt, currency: string) {
  const rows = r.items
    .map(
      (i) =>
        `<tr><td>${htmlText(i.name)}<br><small>${i.qty} × ${htmlText(formatMoney(i.unit, { currency }))}</small></td><td>${htmlText(formatMoney(i.unit * i.qty, { currency }))}</td></tr>`,
    )
    .join("");
  const change = r.cash !== undefined ? Math.max(0, r.cash - r.total) : undefined;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlText(r.code)}</title><style>
body{font:12px ui-monospace,Menlo,monospace;width:72mm;margin:0 auto;padding:8px;color:#000}
h1{font-size:14px;text-align:center;margin:0 0 2px}p{margin:0;text-align:center}table{width:100%;border-collapse:collapse;margin:8px 0}
td{padding:3px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.sum td{border-top:1px dashed #000;font-weight:bold}
small{color:#444}</style></head><body><h1>${htmlText(r.business)}</h1><p>${htmlText(r.code)} · ${htmlText(when(r.at))}</p>
${r.cashier ? `<p>Cashier: ${htmlText(r.cashier)}</p>` : ""}${r.customer ? `<p>Customer: ${htmlText(r.customer)}</p>` : ""}
<table>${rows}<tr class="sum"><td>Total</td><td>${htmlText(formatMoney(r.total, { currency }))}</td></tr>
<tr><td>${htmlText(r.method)}</td><td>${r.cash !== undefined ? htmlText(formatMoney(r.cash, { currency })) : ""}</td></tr>
${change !== undefined ? `<tr><td>Change</td><td>${htmlText(formatMoney(change, { currency }))}</td></tr>` : ""}</table><p>Thank you!</p>
<script>window.onload=()=>{window.print();}</script></body></html>`;
}

export function SaleReceipt({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const currency = useCurrency();
  const print = () => {
    if (!receipt) return;
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) return;
    w.document.write(receiptHtml(receipt, currency));
    w.document.close();
  };
  const change = receipt?.cash !== undefined ? Math.max(0, receipt.cash - receipt.total) : undefined;
  return (
    <Dialog open={!!receipt} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {receipt ? (
          <>
            <DialogHeader>
              <DialogTitle>Sale {receipt.code} completed</DialogTitle>
              <DialogDescription>
                {when(receipt.at)}
                {receipt.cashier ? ` · ${receipt.cashier}` : ""}
                {receipt.customer ? ` · ${receipt.customer}` : ""}
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y rounded-md border">
              {receipt.items.map((i) => (
                <li key={i.name} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate">
                    {i.name} <span className="text-muted-foreground">× {i.qty}</span>
                  </span>
                  <span className="font-mono tabular">{formatMoney(i.unit * i.qty, { currency })}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-right font-mono font-semibold tabular">
                {formatMoney(receipt.total, { currency })}
              </dd>
              <dt className="text-muted-foreground">{receipt.method}</dt>
              <dd className="text-right font-mono tabular">
                {receipt.cash !== undefined ? formatMoney(receipt.cash, { currency }) : "Paid"}
              </dd>
              {change !== undefined ? (
                <>
                  <dt className="text-muted-foreground">Change</dt>
                  <dd className="text-right font-mono font-medium tabular">
                    {formatMoney(change, { currency })}
                  </dd>
                </>
              ) : null}
            </dl>
            <DialogFooter>
              <Button variant="outline" onClick={print}>
                <PrinterIcon data-icon="inline-start" />
                Print receipt
              </Button>
              <Button onClick={onClose} autoFocus>
                New sale
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
