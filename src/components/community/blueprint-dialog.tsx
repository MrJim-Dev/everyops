"use client";

import { type ReactElement, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CatalogSystem } from "@/lib/catalog";

/** The whole system is this JSON. Hulma renders it; no code is generated. */
export function BlueprintDialog({ system, trigger }: { system: CatalogSystem; trigger: ReactElement }) {
  const blueprint = useMemo(() => system.sample(new Date("2026-10-13T09:00:00+08:00")).blueprint, [system]);
  const json = useMemo(() => JSON.stringify(blueprint, null, 2), [blueprint]);
  const size = new TextEncoder().encode(JSON.stringify(blueprint)).length;
  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{system.name} blueprint</DialogTitle>
          <DialogDescription>
            This file is the entire system: {blueprint.entities.length} record types, {blueprint.views.length}{" "}
            screens and {blueprint.rules.length} rules in {(size / 1024).toFixed(1)} KB. Hulma's engine
            renders it; no code is generated.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md border bg-shell p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          {json}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
