"use client";

import { PrinterIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PaperSize } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";

const PAGE: Record<PaperSize, string> = {
  a4: "size: A4; margin: 16mm",
  letter: "size: letter; margin: 16mm",
  receipt: "size: 80mm auto; margin: 4mm",
};

/** The paper's look, scoped to one selector, shared by the preview and the printed page so they match. */
export function paperCss(scope: string, paper: PaperSize = "a4"): string {
  const receipt = paper === "receipt";
  return [
    scope +
      "{color:#111;background:#fff;font:" +
      (receipt
        ? "12px/1.45 ui-monospace,Menlo,monospace"
        : "13px/1.55 Geist,-apple-system,Helvetica,Arial,sans-serif") +
      ";overflow-wrap:anywhere}",
    `${scope} h1{font-size:${receipt ? "15px;text-align:center" : "22px"};font-weight:650;margin:0 0 4px}`,
    `${scope} h2{font-size:${receipt ? "13px;text-align:center" : "16px"};font-weight:600;margin:14px 0 6px}`,
    `${scope} h3{font-size:13px;font-weight:600;margin:14px 0 4px}`,
    `${scope} p{margin:8px 0}`,
    `${scope} table{width:100%;border-collapse:collapse;margin:12px 0}`,
    `${scope} th{font-weight:600;border-bottom:1.5px solid #111;padding:6px 6px 6px 0;text-align:left}`,
    `${scope} td{border-bottom:1px solid #ddd;padding:6px 6px 6px 0;vertical-align:top}`,
    `${scope} hr{border:0;border-top:1px ${receipt ? "dashed #111" : "solid #ddd"};margin:18px 0}`,
    `${scope} img{max-width:220px;max-height:140px;display:block;margin:8px 0}`,
    `${scope} ul,ol{padding-left:20px}`,
    `${scope} a{color:inherit}`,
    `${scope} blockquote{margin:8px 0;padding-left:10px;border-left:2px solid #ccc;color:#444}`,
  ].join("\n");
}

const htmlText = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * Opens the rendered document in its own window, sized for its paper, and opens the print dialog once its
 * pictures have loaded. The browser's dialog prints it or saves it as a PDF.
 */
export function printHtml(title: string, html: string, paper: PaperSize = "a4") {
  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) return false;
  const width = paper === "receipt" ? "72mm" : "720px";
  w.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><base href="' +
      htmlText(window.location.origin) +
      '/"><title>' +
      htmlText(title) +
      "</title><style>@page{" +
      PAGE[paper] +
      "}body{margin:0;padding:16px}.paper{max-width:" +
      width +
      ";margin:0 auto}@media print{body{padding:0}}\n" +
      paperCss(".paper", paper) +
      '</style></head><body><div class="paper">' +
      html +
      "</div><script>Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>{window.focus();window.print();});</script></body></html>",
  );
  w.document.close();
  return true;
}

/** A filled-in print template on its paper, as it will print. */
export function PrintPaper({
  markdown,
  paper = "a4",
  className,
  paperRef,
}: {
  markdown: string;
  paper?: PaperSize;
  className?: string;
  paperRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={cn(
        "rounded-md bg-white p-8 shadow-sm",
        paper === "receipt" && "mx-auto max-w-[320px] p-4",
        className,
      )}
    >
      <style>{paperCss(".everyops-paper", paper)}</style>
      <div ref={paperRef} className="everyops-paper">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

/** Preview of one record's document, with Print (which also saves a PDF). */
export function PrintDialog({
  open,
  title,
  description,
  markdown,
  paper,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  markdown: string;
  paper?: PaperSize;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const print = () => {
    if (ref.current) printHtml(title, ref.current.innerHTML, paper);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[min(90dvh,900px)] flex-col gap-4 sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "Print it, or choose Save as PDF in the print dialog."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto bg-muted/40 px-6 py-5">
          <PrintPaper markdown={markdown} paper={paper} paperRef={ref} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={print} autoFocus>
            <PrinterIcon data-icon="inline-start" />
            Print or save PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
