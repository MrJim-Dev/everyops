"use client";

import { CheckIcon, CodeIcon, EyeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { CatalogSystem } from "@/lib/catalog";
import { BlueprintDialog } from "./blueprint-dialog";
import { SystemThumbnail } from "./system-thumbnail";
import { UseSystemButton } from "./use-system-dialog";

export function SystemDetail({ system }: { system: CatalogSystem }) {
  return (
    <div className="flex flex-col gap-5">
      <SystemThumbnail system={system} />
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold tracking-tight">{system.name}</h2>
        <p className="text-[12.5px] text-muted-foreground">
          By {system.author} · {system.license} license · Version {system.version}
        </p>
      </div>
      <p className="text-[13.5px] leading-relaxed">{system.summary}</p>
      <section>
        <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">Included</h3>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {system.includes.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <CheckIcon className="size-3.5 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-col gap-2">
        <UseSystemButton systemId={system.id} />
        <Button variant="outline" render={<Link href={`/preview/${system.id}`} />} nativeButton={false}>
          <EyeIcon data-icon="inline-start" />
          {system.authorId ? "Preview" : "Preview with sample data"}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          Creates your own copy. Your business data stays private.
        </p>
      </div>
      <BlueprintDialog
        system={system}
        trigger={
          <Button variant="ghost" size="sm" className="self-start text-muted-foreground">
            <CodeIcon data-icon="inline-start" />
            View blueprint
          </Button>
        }
      />
    </div>
  );
}
