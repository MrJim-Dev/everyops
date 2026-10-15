"use client";

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsInLineHorizontalIcon,
  ArrowsOutLineHorizontalIcon,
  ArrowUpIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import type { LayoutItem, LayoutSection, LayoutView } from "@/lib/blueprint/types";
import {
  addItem,
  addSection,
  moveItem,
  moveSection,
  removeItem,
  removeSection,
  renameSection,
  resizeItem,
  setColumns,
} from "@/lib/components/layout-edit";
import { componentDef } from "@/lib/components/registry";
import { type PartSuggestion, suggestParts } from "@/lib/components/suggest";
import { cn } from "@/lib/utils";
import { PartGrid } from "./shared";

const GROUPS: { id: PartSuggestion["group"]; label: string }[] = [
  { id: "data", label: "From your records" },
  { id: "cards", label: "Dashboard cards" },
  { id: "basics", label: "Basics" },
];

type Edit = (next: LayoutSection[]) => void;

/** One small icon button of the edit controls. */
function Tool({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(danger && "text-muted-foreground hover:text-destructive")}
    >
      {children}
    </Button>
  );
}

/** Add a part to one section: the suggestions that fit this workspace, or a description for EveryOps to build. */
function AddPart({
  view,
  sections,
  index,
  onChange,
}: {
  view: LayoutView;
  sections: LayoutSection[];
  index: number;
  onChange: Edit;
}) {
  const ws = useWorkspace();
  const setOpen = useAssistant((s) => s.setOpen);
  const setDraft = useAssistant((s) => s.setDraft);
  const suggestions = useMemo(
    () => suggestParts(ws.blueprint, { ...view, sections }),
    [ws.blueprint, view, sections],
  );
  const section = sections[index];
  const describe = () => {
    const where = section?.title ? ` in the "${section.title}" section` : "";
    setDraft(`Add to the ${view.name} page${where}: `);
    setOpen(true);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
        <PlusIcon data-icon="inline-start" />
        Add part
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-80">
        {GROUPS.map((g) => {
          const items = suggestions.filter((s) => s.group === g.id);
          if (!items.length) return null;
          return (
            <DropdownMenuGroup key={g.id}>
              <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
              {items.map((s) => (
                <DropdownMenuItem key={s.key} onClick={() => onChange(addItem(sections, index, s.item))}>
                  <span className="truncate">{s.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={describe}>
            <SparkleIcon />
            Describe a new part…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A part while editing: the part itself under a strip of controls to move, resize or remove it. */
function EditablePart({
  item,
  at,
  sections,
  onChange,
  children,
}: {
  item: LayoutItem;
  at: { section: number; item: number };
  sections: LayoutSection[];
  onChange: Edit;
  children: ReactNode;
}) {
  const section = sections[at.section];
  const def = componentDef(item.component);
  const span = item.span ?? (def?.wide ? section.columns : 1);
  const name = def?.name ?? item.component;
  const first = at.section === 0 && at.item === 0;
  const last = at.section === sections.length - 1 && at.item === section.items.length - 1;
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-dashed bg-muted/40 px-2 py-0.5">
        <span className="mr-auto truncate text-[11.5px] text-muted-foreground">{name}</span>
        <Tool
          label={`Move ${name} earlier`}
          disabled={first}
          onClick={() => onChange(moveItem(sections, at, -1))}
        >
          <ArrowLeftIcon />
        </Tool>
        <Tool
          label={`Move ${name} later`}
          disabled={last}
          onClick={() => onChange(moveItem(sections, at, 1))}
        >
          <ArrowRightIcon />
        </Tool>
        <Tool
          label={`Make ${name} narrower`}
          disabled={span <= 1}
          onClick={() => onChange(resizeItem(sections, at, -1))}
        >
          <ArrowsInLineHorizontalIcon />
        </Tool>
        <Tool
          label={`Make ${name} wider`}
          disabled={span >= section.columns}
          onClick={() => onChange(resizeItem(sections, at, 1))}
        >
          <ArrowsOutLineHorizontalIcon />
        </Tool>
        <Tool label={`Remove ${name}`} danger onClick={() => onChange(removeItem(sections, at))}>
          <TrashIcon />
        </Tool>
      </div>
      {/* The part stays visible, but clicks go to the controls while editing. */}
      <div className="pointer-events-none min-h-0 flex-1 select-none">{children}</div>
    </div>
  );
}

/**
 * Edit layout: the page's sections as a draft the owner rearranges. Parts move earlier or later, get wider or
 * narrower, or go; sections can be renamed, moved, given 1 to 4 columns, added or removed; parts come from
 * suggestions or from a description sent to EveryOps. Nothing saves until the owner presses Save.
 */
export function LayoutEditor({
  view,
  sections,
  onChange,
  renderItem,
}: {
  view: LayoutView;
  sections: LayoutSection[];
  onChange: Edit;
  renderItem: (item: LayoutItem) => ReactNode;
}) {
  return (
    <div className="flex w-full flex-col pb-6">
      {sections.map((section, si) => (
        <section key={section.id} className="flex flex-col border-b">
          <header className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Input
              aria-label="Section title"
              placeholder="Untitled section"
              defaultValue={section.title ?? ""}
              onBlur={(e) => {
                if ((e.target.value.trim() || undefined) !== section.title)
                  onChange(renameSection(sections, si, e.target.value));
              }}
              className="h-7 w-48 text-[12.5px]"
            />
            <ToggleGroup
              aria-label="Columns"
              size="sm"
              variant="outline"
              value={[String(section.columns)]}
              onValueChange={(v: string[]) => {
                if (v[0]) onChange(setColumns(sections, si, Number(v[0])));
              }}
            >
              {[1, 2, 3, 4].map((n) => (
                <ToggleGroupItem
                  key={n}
                  value={String(n)}
                  aria-label={`${n} columns`}
                  className="px-2 text-[12px]"
                >
                  {n}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <span className="text-[11.5px] text-muted-foreground">columns</span>
            <AddPart view={view} sections={sections} index={si} onChange={onChange} />
            <span className="ml-auto flex items-center gap-0.5">
              <Tool
                label="Move section up"
                disabled={si === 0}
                onClick={() => onChange(moveSection(sections, si, -1))}
              >
                <ArrowUpIcon />
              </Tool>
              <Tool
                label="Move section down"
                disabled={si === sections.length - 1}
                onClick={() => onChange(moveSection(sections, si, 1))}
              >
                <ArrowDownIcon />
              </Tool>
              <Tool label="Remove section" danger onClick={() => onChange(removeSection(sections, si))}>
                <TrashIcon />
              </Tool>
            </span>
          </header>
          {section.items.length ? (
            <PartGrid
              items={section.items}
              columns={section.columns}
              className="border-t"
              render={(item) => (
                <EditablePart
                  item={item}
                  at={{ section: si, item: section.items.indexOf(item) }}
                  sections={sections}
                  onChange={onChange}
                >
                  {renderItem(item)}
                </EditablePart>
              )}
            />
          ) : (
            <p className="border-t border-dashed px-5 py-6 text-[13px] text-muted-foreground">
              No parts yet. Use Add part to put something here; empty sections are left out when you save.
            </p>
          )}
        </section>
      ))}
      <div className="px-4 py-3">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(addSection(sections))}>
          <PlusIcon data-icon="inline-start" />
          Add section
        </Button>
      </div>
    </div>
  );
}
