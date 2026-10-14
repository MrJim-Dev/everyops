"use client";

import { CheckIcon, CodeIcon, EyeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { SystemIcon } from "@/components/system-icon";
import { Button } from "@/components/ui/button";
import { CATEGORIES, type CatalogSystem } from "@/lib/catalog";
import { BlueprintDialog } from "./blueprint-dialog";
import { formatUses } from "./system-card";
import { SystemShot } from "./system-shot";
import { UseSystemButton } from "./use-system-dialog";

/** Everything needed to decide on a system, laid out top to bottom in the side sheet. */
export function SystemDetail({ system }: { system: CatalogSystem }) {
  const facts = [
    [
      "Copies",
      system.uses ? `${formatUses(system.uses)} ${system.uses === 1 ? "workspace" : "workspaces"}` : "New",
    ],
    ["Category", CATEGORIES.find((c) => c.id === system.category)?.label ?? "Other"],
    ["Version", system.version],
    ["License", system.license],
  ];
  return (
    <div className="flex min-h-full flex-col">
      <div className="relative overflow-hidden border-b bg-shell px-6 pt-14">
        <div aria-hidden="true" className="bg-grid absolute inset-0" />
        <div className="relative overflow-hidden rounded-t-xl border border-b-0 border-foreground/10 shadow-[0_-12px_40px_-16px_rgba(0,0,0,0.8)]">
          <SystemShot system={system} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-7 p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <SystemIcon name={system.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.02em]">{system.name}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">By {system.author}</p>
          </div>
        </div>
        <p className="text-[14px] leading-relaxed">{system.summary}</p>
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border">
          {facts.map(([label, value], i) => (
            <div
              key={label}
              className={`flex flex-col gap-0.5 p-3.5 ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t" : ""}`}
            >
              <dt className="text-[12px] text-muted-foreground">{label}</dt>
              <dd className="text-[13.5px] font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <section className="flex flex-col gap-2.5">
          <h3 className="text-[13px] font-medium">What's included</h3>
          <ul className="flex flex-col gap-2 text-[13.5px] text-muted-foreground">
            {system.includes.map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <CheckIcon weight="bold" className="size-3.5 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </section>
        <BlueprintDialog
          system={system}
          trigger={
            <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground">
              <CodeIcon data-icon="inline-start" />
              View the blueprint
            </Button>
          }
        />
      </div>
      <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-popover/90 p-4 backdrop-blur-xl">
        <UseSystemButton systemId={system.id} className="h-10 w-full" />
        <Button
          variant="outline"
          className="h-10"
          render={<Link href={`/preview/${system.id}`} />}
          nativeButton={false}
        >
          <EyeIcon data-icon="inline-start" />
          {system.authorId ? "Preview" : "Preview with sample data"}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          Creates your own copy. Your business data stays private.
        </p>
      </div>
    </div>
  );
}
