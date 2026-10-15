"use client";

import { CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Markdown } from "@/components/editor/markdown";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, recordTitle } from "@/lib/blueprint/lookup";
import type { LayoutItem } from "@/lib/blueprint/types";
import { viewMarkdown } from "@/lib/components/view-markdown";
import { cn } from "@/lib/utils";
import { Nothing, PartCard, PartGrid, useRows, useViewHref } from "./shared";

type P<T> = { props: T };

function ViewMarkdown({ children, className }: { children: string; className?: string }) {
  const hrefFor = useViewHref();
  return <Markdown className={className}>{viewMarkdown(children, hrefFor)}</Markdown>;
}

export function HeadingPart({ props }: P<{ title: string; description?: string }>) {
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 bg-background px-5 py-3">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{props.title}</h2>
      {props.description ? <p className="text-[12.5px] text-muted-foreground">{props.description}</p> : null}
    </div>
  );
}

export function TextPart({ props }: P<{ markdown: string }>) {
  return (
    <div className="h-full bg-background px-5 py-4">
      <ViewMarkdown className="text-[13px]">{props.markdown}</ViewMarkdown>
    </div>
  );
}

export function CardPart({
  props,
}: P<{ title: string; description?: string; markdown?: string; footer?: string }>) {
  return (
    <PartCard title={props.title} description={props.description} footer={props.footer}>
      {props.markdown ? (
        <ViewMarkdown className="text-[13px] text-muted-foreground">{props.markdown}</ViewMarkdown>
      ) : null}
    </PartCard>
  );
}

const TONES = {
  info: { icon: InfoIcon, className: "text-muted-foreground" },
  success: { icon: CheckCircleIcon, className: "text-primary" },
  warning: { icon: WarningIcon, className: "text-amber-500" },
  danger: { icon: WarningCircleIcon, className: "text-destructive" },
} as const;

/** A callout as one quiet row: the tone's icon, a bold line and the detail after it. */
export function AlertPart({
  props,
}: P<{ title: string; description?: string; tone: "info" | "success" | "warning" | "danger" }>) {
  const tone = TONES[props.tone] ?? TONES.info;
  const Icon = tone.icon;
  return (
    <div role="alert" className="flex h-full items-start gap-2.5 bg-background px-5 py-3 text-[13px]">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone.className)} />
      <p className="min-w-0">
        <span className="font-medium">{props.title}</span>
        {props.description ? <span className="text-muted-foreground"> {props.description}</span> : null}
      </p>
    </div>
  );
}

export function SeparatorPart() {
  return <div aria-hidden="true" className="h-2 bg-background" />;
}

export function ButtonPart({
  props,
}: P<{ label: string; viewId: string; variant: "default" | "outline" | "secondary" }>) {
  const href = useViewHref()(props.viewId);
  if (!href) return null;
  return <LinkButton href={href} label={props.label} variant={props.variant} />;
}

export function LinkButton({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: "default" | "outline" | "secondary";
}) {
  return (
    <div className="flex h-full items-center bg-background px-5 py-3">
      <Link href={href} className={cn(buttonVariants({ variant, size: "sm" }), "w-fit")}>
        {label}
      </Link>
    </div>
  );
}

export function AccordionPart({
  props,
}: P<{
  title?: string;
  items?: { title: string; body: string }[];
  entityId?: string;
  titleFieldId?: string;
  bodyFieldId?: string;
  filter?: string;
}>) {
  return (
    <AccordionFrame title={props.title}>
      {props.entityId ? (
        <RecordAccordion {...props} entityId={props.entityId} />
      ) : (
        <AccordionItems items={props.items ?? []} />
      )}
    </AccordionFrame>
  );
}

export function AccordionFrame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <PartCard title={title} contentClassName="px-5 pb-2">
      {children}
    </PartCard>
  );
}

export function AccordionItems({ items }: { items: { title: string; body: string }[] }) {
  if (!items.length) return <Nothing />;
  return (
    <Accordion>
      {items.map((it, i) => (
        <AccordionItem key={`${i}-${it.title}`} value={String(i)}>
          <AccordionTrigger className="py-2.5">{it.title}</AccordionTrigger>
          <AccordionContent>
            <ViewMarkdown className="text-[13px] text-muted-foreground">{it.body}</ViewMarkdown>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function RecordAccordion({
  entityId,
  titleFieldId,
  bodyFieldId,
  filter,
}: {
  entityId: string;
  titleFieldId?: string;
  bodyFieldId?: string;
  filter?: string;
}) {
  const { blueprint } = useWorkspace();
  const entity = getEntity(blueprint, entityId);
  const rows = useRows(entityId, filter);
  return (
    <AccordionItems
      items={rows.map((r) => ({
        title: titleFieldId ? String(r.data[titleFieldId] ?? "") : recordTitle(entity, r),
        body: bodyFieldId ? String(r.data[bodyFieldId] ?? "") : "",
      }))}
    />
  );
}

/** Tabs underlined like a page's own tabs; each tab's parts sit in the same hairline grid, two to a row. */
export function TabsPart({
  props,
  renderItem,
}: P<{ tabs: { label: string; items: LayoutItem[] }[] }> & { renderItem: (item: LayoutItem) => ReactNode }) {
  const first = props.tabs[0]?.label ?? "";
  return (
    <Tabs defaultValue={first} className="gap-0 bg-background">
      <div className="border-b px-5 pt-2">
        <TabsList variant="line" className="h-9">
          {props.tabs.map((t) => (
            <TabsTrigger key={t.label} value={t.label} className="text-[13px]">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {props.tabs.map((t) => (
        <TabsContent key={t.label} value={t.label}>
          <PartGrid items={t.items} columns={t.items.length > 1 ? 2 : 1} render={renderItem} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
