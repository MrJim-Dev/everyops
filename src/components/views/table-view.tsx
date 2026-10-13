"use client";

import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { StatusMenu } from "@/components/records/status-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useReportView } from "@/lib/assistant/screen-store";
import { displayKind, isNumericKind } from "@/lib/blueprint/field-kind";
import { getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import type { Sort, TableView as TableViewConfig } from "@/lib/blueprint/types";
import { applyFilter, searchRecords, sortRecords } from "@/lib/engine/query";
import { useFreshStore } from "@/lib/motion/fresh";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { SearchInput } from "./search-input";
import { ViewEmpty } from "./view-empty";
import { ToolbarSummary, ViewToolbar } from "./view-toolbar";

export function TableView({ view }: { view: TableViewConfig }) {
  const ws = useWorkspace();
  const { blueprint, records } = ws;
  const { openRecord, openCreate } = useRecordPanels();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const entity = getEntity(blueprint, view.entityId);
  const fields = view.fieldIds.map((id) => getField(entity, id));
  const fresh = useFreshStore((s) => s.ids);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort[] | undefined>(view.sort);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  // Owners and admins can reorder columns by hand: drag a header, or Alt+←/→ on it. Saved as a change in History.
  const reorderable = ws.mode === "live" && canManage(ws.role);

  const moveColumn = (fieldId: string, to: number) => {
    const from = view.fieldIds.indexOf(fieldId);
    if (from < 0 || to < 0 || to >= view.fieldIds.length || to === from) return;
    const order = view.fieldIds.filter((id) => id !== fieldId);
    order.splice(to, 0, fieldId);
    const names = order.map((id) => getField(entity, id).name).join(", ");
    const entry = applyChange(ws.id, {
      request: `Reorder the columns of ${view.name}`,
      title: `Reorder ${view.name} columns`,
      facts: [],
      steps: [{ kind: "change", label: `${view.name} columns`, detail: names }],
      ops: [{ op: "update_view", viewId: view.id, patch: { fieldIds: order } }],
    });
    if (entry) toast("Columns reordered", { description: "Saved to History, where you can undo it." });
  };

  const rows = useMemo(() => {
    const filtered = applyFilter(blueprint, entity, records, view.filter);
    const searched = searchRecords(filtered, query, (r) =>
      [recordTitle(entity, r), ...fields.map((f) => JSON.stringify(r.data[f.id] ?? ""))].join(" "),
    );
    return sortRecords(searched, sort);
  }, [blueprint, entity, records, view.filter, query, sort, fields]);
  useReportView({ viewId: view.id, search: query.trim() || undefined });

  const toggleSort = (fieldId: string) =>
    setSort((s) =>
      s?.[0]?.fieldId === fieldId && s[0].dir === "asc"
        ? [{ fieldId, dir: "desc" }]
        : [{ fieldId, dir: "asc" }],
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToolbar>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={`Search ${entity.pluralName.toLowerCase()}`}
        />
        <ToolbarSummary>
          {rows.length} {rows.length === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase()}
        </ToolbarSummary>
      </ViewToolbar>
      {rows.length === 0 ? (
        <ViewEmpty
          title={query ? "No matches" : `No ${entity.pluralName.toLowerCase()} yet`}
          description={
            query ? "Try a different search." : `Add the first ${entity.name.toLowerCase()} to get started.`
          }
          actionLabel={query ? undefined : `New ${entity.name.toLowerCase()}`}
          onAction={() => openCreate(entity.id)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="text-[13px]">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="hover:bg-transparent">
                {fields.map((field, i) => {
                  const numeric = isNumericKind(displayKind(blueprint, field));
                  const active = sort?.[0]?.fieldId === field.id ? sort[0].dir : null;
                  return (
                    <TableHead
                      key={field.id}
                      aria-sort={active ? (active === "asc" ? "ascending" : "descending") : undefined}
                      draggable={reorderable}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", field.id);
                        setDragging(field.id);
                      }}
                      onDragOver={(e) => {
                        if (!dragging) return;
                        e.preventDefault();
                        setDropOn(field.id);
                      }}
                      onDragLeave={() => setDropOn((d) => (d === field.id ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging) moveColumn(dragging, i);
                        setDragging(null);
                        setDropOn(null);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropOn(null);
                      }}
                      className={cn(
                        "h-9 text-[12px] font-normal text-muted-foreground",
                        i === 0 && "pl-5",
                        i === fields.length - 1 && "pr-5",
                        numeric && "text-right",
                        reorderable && "cursor-grab",
                        dragging === field.id && "opacity-50",
                        dropOn === field.id && dragging !== field.id && "bg-muted",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(field.id)}
                        onKeyDown={(e) => {
                          if (!reorderable || !e.altKey) return;
                          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                          e.preventDefault();
                          moveColumn(field.id, i + (e.key === "ArrowLeft" ? -1 : 1));
                        }}
                        title={reorderable ? "Sort. Drag or Alt+←/→ to move the column" : undefined}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                          numeric && "flex-row-reverse",
                        )}
                      >
                        {field.name}
                        {active === "asc" ? (
                          <CaretUpIcon className="size-3" />
                        ) : active === "desc" ? (
                          <CaretDownIcon className="size-3" />
                        ) : null}
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  onClick={() => openRecord(row.id)}
                  onKeyDown={(e) => e.key === "Enter" && openRecord(row.id)}
                  className={cn(
                    "h-10 cursor-default outline-none focus-visible:bg-muted",
                    fresh[row.id] && "animate-flash",
                  )}
                >
                  {fields.map((field, i) => {
                    const numeric = isNumericKind(displayKind(blueprint, field));
                    return (
                      <TableCell
                        key={field.id}
                        className={cn(
                          "max-w-[280px] truncate py-2",
                          i === 0 && "pl-5 font-medium",
                          i === fields.length - 1 && "pr-5",
                          numeric && "text-right",
                        )}
                      >
                        {field.type === "status" ? (
                          <StatusMenu record={row} field={field} />
                        ) : (
                          <FieldValue field={field} value={row.data[field.id]} />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
