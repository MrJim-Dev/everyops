"use client";

import { CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Markdown } from "@/components/editor/markdown";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, recordTitle } from "@/lib/blueprint/lookup";
import type { LayoutItem } from "@/lib/blueprint/types";
import { componentDef } from "@/lib/components/registry";
import { cn } from "@/lib/utils";
import { Nothing, PartCard, useRows, useViewHref } from "./shared";

type P<T> = { props: T };

export function HeadingPart({ props }: P<{ title: string; description?: string }>) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{props.title}</h2>
      {props.description ? <p className="text-[13px] text-muted-foreground">{props.description}</p> : null}
    </div>
  );
}

export function TextPart({ props }: P<{ markdown: string }>) {
  return <Markdown className="text-[13.5px]">{props.markdown}</Markdown>;
}

export function CardPart({
  props,
}: P<{ title: string; description?: string; markdown?: string; footer?: string }>) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.description ? <CardDescription>{props.description}</CardDescription> : null}
      </CardHeader>
      {props.markdown ? (
        <CardContent>
          <Markdown className="text-[13.5px]">{props.markdown}</Markdown>
        </CardContent>
      ) : null}
      {props.footer ? (
        <CardFooter className="text-[12.5px] text-muted-foreground">{props.footer}</CardFooter>
      ) : null}
    </Card>
  );
}

const TONES = {
  info: { icon: InfoIcon, className: "" },
  success: { icon: CheckCircleIcon, className: "[&>svg]:text-primary" },
  warning: { icon: WarningIcon, className: "[&>svg]:text-amber-500" },
  danger: { icon: WarningCircleIcon, className: "text-destructive [&>svg]:text-destructive" },
} as const;

export function AlertPart({
  props,
}: P<{ title: string; description?: string; tone: "info" | "success" | "warning" | "danger" }>) {
  const tone = TONES[props.tone] ?? TONES.info;
  const Icon = tone.icon;
  return (
    <Alert className={tone.className}>
      <Icon aria-hidden="true" />
      <AlertTitle>{props.title}</AlertTitle>
      {props.description ? <AlertDescription>{props.description}</AlertDescription> : null}
    </Alert>
  );
}

export function SeparatorPart() {
  return <Separator className="my-1" />;
}

export function ButtonPart({
  props,
}: P<{ label: string; viewId: string; variant: "default" | "outline" | "secondary" }>) {
  const href = useViewHref()(props.viewId);
  if (!href) return null;
  return (
    <Link href={href} className={cn(buttonVariants({ variant: props.variant }), "w-fit")}>
      {props.label}
    </Link>
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
  const body = props.entityId ? (
    <RecordAccordion {...props} entityId={props.entityId} />
  ) : (
    <AccordionItems items={props.items ?? []} />
  );
  return props.title ? <PartCard title={props.title}>{body}</PartCard> : body;
}

export function AccordionItems({ items }: { items: { title: string; body: string }[] }) {
  if (!items.length) return <Nothing />;
  return (
    <Accordion>
      {items.map((it, i) => (
        <AccordionItem key={`${i}-${it.title}`} value={String(i)}>
          <AccordionTrigger>{it.title}</AccordionTrigger>
          <AccordionContent>
            <Markdown className="text-[13px] text-muted-foreground">{it.body}</Markdown>
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

/** Tabs that each hold their own components; they render with the same renderer as the page. */
export function TabsPart({
  props,
  renderItem,
}: P<{ tabs: { label: string; items: LayoutItem[] }[] }> & {
  renderItem: (item: LayoutItem) => React.ReactNode;
}) {
  const first = props.tabs[0]?.label ?? "";
  return (
    <Tabs defaultValue={first} className="gap-3">
      <TabsList>
        {props.tabs.map((t) => (
          <TabsTrigger key={t.label} value={t.label}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {props.tabs.map((t) => (
        <TabsContent key={t.label} value={t.label}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {t.items.map((item) => {
              // A tab's only part, a wide part (table, stat cards, a workspace view) or one given a span fills the row.
              const full =
                t.items.length === 1 || (item.span ?? 0) >= 2 || !!componentDef(item.component)?.wide;
              return (
                <div key={item.id} className={cn("min-w-0", full && "md:col-span-2")}>
                  {renderItem(item)}
                </div>
              );
            })}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
