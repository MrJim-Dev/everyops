"use client";

import {
  ArrowsOutSimpleIcon,
  BarcodeIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  DownloadSimpleIcon,
  FileArrowUpIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImportDialog } from "@/components/import/import-dialog";
import { SheetSyncBar } from "@/components/import/sheet-sync-bar";
import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { StatusMenu } from "@/components/records/status-menu";
import { ScanDialog } from "@/components/scan/scan-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useReportView } from "@/lib/assistant/screen-store";
import { displayKind, isNumericKind, statusField } from "@/lib/blueprint/field-kind";
import { getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import { sameCode, scannableFields } from "@/lib/blueprint/scannable";
import type { DataRecord, Field, Sort, TableView as TableViewConfig } from "@/lib/blueprint/types";
import { downloadText, fileSlug } from "@/lib/download";
import { tableRows } from "@/lib/engine/table-rows";
import { toCsv, toSheet } from "@/lib/engine/value-text";
import { currencyOf, currencySymbol, formatDuration, formatMoney, formatNumber } from "@/lib/format";
import { useFreshStore } from "@/lib/motion/fresh";
import { useViewPref } from "@/lib/store/view-prefs";
import type { StoredRecord } from "@/lib/store/workspace-sync";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { canEditInline, EditableCell } from "./editable-cell";
import { SearchInput } from "./search-input";
import { ViewEmpty } from "./view-empty";
import { ViewPrefToggle } from "./view-pref-toggle";
import { ToolbarSummary, ViewToolbar } from "./view-toolbar";

const GROUPABLE = new Set(["choice", "status", "relation", "person", "checkbox"]);
const NO_GROUP = "__none";
/**
 * Rows on screen at once. A busy workspace's history runs to tens of thousands of rows; drawing them all crashed the
 * tab at 20,000. Search, sorting, grouping, totals and select-all still cover every matching row.
 */
export const PAGE_SIZE = 100;

type Group = { key: string; label: string; rows: DataRecord[] };

type RemoteRows = {
  total: number;
  rows: StoredRecord[];
  totals: Record<string, number>;
  groups: { key: string; label: string; count: number; totals: Record<string, number> }[] | null;
};

/** A page of a table worked out on the server (src/server/view-rows.ts), or null when it can't be read. */
async function fetchRows(
  workspaceId: string,
  viewId: string,
  qs: URLSearchParams,
): Promise<RemoteRows | null> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/views/${encodeURIComponent(viewId)}/rows?${qs}`,
    { cache: "no-store" },
  ).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as RemoteRows | null) : null;
}

export function TableView({ view }: { view: TableViewConfig }) {
  const ws = useWorkspace();
  const { blueprint, records } = ws;
  const { openRecord, openCreate } = useRecordPanels();
  const actions = useRecordActions();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const entity = getEntity(blueprint, view.entityId);
  // Records with a code field (Barcode, SKU, Serial number) can be found by scanning it.
  const codes = scannableFields(entity);
  const [scanning, setScanning] = useState(false);
  const onScan = (code: string) => {
    const found = records.find(
      (r) => r.entityId === entity.id && codes.some((f) => sameCode(r.data[f.id], code)),
    );
    if (found) return openRecord(found.id);
    const one = entity.name.toLowerCase();
    toast.info(`No ${one} with ${codes[0].name.toLowerCase()} ${code}`, {
      ...(editable
        ? { action: { label: `Add ${one}`, onClick: () => openCreate(entity.id, { [codes[0].id]: code }) } }
        : {}),
    });
  };
  const fields = view.fieldIds.map((id) => getField(entity, id));
  const fresh = useFreshStore((s) => s.ids);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort[] | undefined>(view.sort);
  const [groupBy, setGroupBy] = useState<string>(view.groupByFieldId ?? NO_GROUP);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  // Owners and admins can reorder columns by hand: drag a header, or Alt+←/→ on it. Saved as a change in History.
  const reorderable = ws.mode === "live" && canManage(ws.role);
  const editable = canEdit(ws.role);
  const inlineEdit = useViewPref("inlineEdit") && editable;
  const status = statusField(entity);
  const groupable = entity.fields.filter((f) => GROUPABLE.has(displayKind(blueprint, f)));
  const groupField = groupable.find((f) => f.id === groupBy);
  const numeric = (f: Field) => isNumericKind(displayKind(blueprint, f));
  // Columns with a total: amounts and counts add up, time adds up as time, and ratings show their average.
  const summable = (f: Field) =>
    ["money", "number", "duration", "rating"].includes(displayKind(blueprint, f));

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
    if (entry)
      toast.success("Columns reordered", { description: "Saved to History, where you can undo it." });
  };

  // Large record types page on the server: the browser has only a recent window of them (src/lib/engine/window.ts).
  const windowed = useWorkspaces((s) =>
    ws.mode === "live" ? s.workspaces[ws.id]?.windowed?.[entity.id] : undefined,
  );
  const absorb = useWorkspaces((s) => s.absorb);
  // Paging: the page goes back to the first when the search, sort or grouping changes.
  const pageKey = JSON.stringify([view.id, query, sort, groupBy]);
  const [paging, setPaging] = useState({ key: pageKey, page: 0 });
  // A new search, sort or grouping starts again from the first page (and stays there when it changes back).
  if (paging.key !== pageKey) setPaging({ key: pageKey, page: 0 });
  const pageIndex = paging.key === pageKey ? paging.page : 0;
  const [remote, setRemote] = useState<RemoteRows | null>(null);
  const remoteKey = windowed ? JSON.stringify([pageKey, pageIndex]) : null;
  useEffect(() => {
    if (!remoteKey) return;
    let live = true;
    const timer = setTimeout(
      async () => {
        const qs = new URLSearchParams({
          offset: String(pageIndex * PAGE_SIZE),
          limit: String(PAGE_SIZE),
          q: query.trim(),
          ...(sort?.length ? { sort: JSON.stringify(sort) } : {}),
          ...(groupField ? { group: groupField.id } : {}),
        });
        const body = await fetchRows(ws.id, view.id, qs);
        if (!live || !body) return;
        absorb(ws.id, body.rows);
        setRemote(body);
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [remoteKey, pageIndex, query, sort, groupField, ws.id, view.id, absorb]);

  const local = useMemo(
    () =>
      windowed
        ? { rows: [], groups: null }
        : tableRows(blueprint, entity, view, records, { query, sort, groupField }),
    [windowed, blueprint, entity, view, records, query, sort, groupField],
  );
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const server = windowed ? remote : null;
  const rows: DataRecord[] = server ? server.rows.map((s) => byId.get(s.record.id) ?? s.record) : local.rows;
  const groupKey = (r: DataRecord) => {
    const raw = groupField ? r.data[groupField.id] : undefined;
    return raw === undefined || raw === null || raw === "" ? "" : String(raw);
  };
  const groups: Group[] | null = server
    ? (server.groups
        ?.map((g) => ({ key: g.key, label: g.label, rows: rows.filter((r) => groupKey(r) === g.key) }))
        .filter((g) => g.rows.length) ?? null)
    : local.groups;
  const serverGroup = (key: string) => server?.groups?.find((g) => g.key === key);
  useReportView({ viewId: view.id, search: query.trim() || undefined });
  const visibleIds = rows.map((r) => r.id);
  const ordered = groups ? groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows)) : rows;
  // Rows in all: the server's count when it pages there, else every matching row here.
  const count = server ? server.total : ordered.length;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Math.min(pageIndex, pages - 1);
  const goTo = (n: number) => setPaging({ key: pageKey, page: Math.max(0, Math.min(pages - 1, n)) });
  const onPage = new Set(
    (server ? ordered : ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)).map((r) => r.id),
  );
  const paged = count > PAGE_SIZE;
  const shownRows = (list: DataRecord[]) => (paged && !server ? list.filter((r) => onPage.has(r.id)) : list);
  // Exports cover every matching row, read from the server page by page when it pages there.
  const allRows = async (): Promise<DataRecord[]> => {
    if (!windowed) return rows;
    const out: DataRecord[] = [];
    for (let offset = 0; ; offset += 500) {
      const qs = new URLSearchParams({
        offset: String(offset),
        limit: "500",
        q: query.trim(),
        ...(sort?.length ? { sort: JSON.stringify(sort) } : {}),
      });
      const body = await fetchRows(ws.id, view.id, qs);
      if (!body) break;
      out.push(...body.rows.map((s) => s.record));
      if (offset + 500 >= body.total) break;
    }
    return out;
  };
  const picked = visibleIds.filter((id) => selected.has(id));
  const allPicked = picked.length > 0 && picked.length === visibleIds.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());
  const plural = entity.pluralName.toLowerCase();

  const [importing, setImporting] = useState(false);
  const exportXlsx = async (list: DataRecord[]) => {
    const sheet = toSheet(blueprint, records, fields, list);
    const name =
      view.name.startsWith("All ") || view.name === entity.pluralName
        ? entity.pluralName
        : `${entity.pluralName} - ${view.name}`;
    const res = await fetch("/api/export/xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ...sheet, currencySymbol: currencySymbol(currencyOf(blueprint)) }),
    }).catch(() => null);
    if (!res?.ok) return void toast.error("The Excel file couldn't be made. Try CSV instead.");
    const url = URL.createObjectURL(await res.blob());
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `${fileSlug(name)}.xlsx`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${list.length} ${list.length === 1 ? entity.name.toLowerCase() : plural}`);
  };
  const exportCsv = (list: DataRecord[]) => {
    downloadText(`${fileSlug(view.name)}.csv`, toCsv(blueprint, records, fields, list), "text/csv");
    toast.success(`Exported ${list.length} ${list.length === 1 ? entity.name.toLowerCase() : plural}`);
  };
  const setStatus = (optionId: string) => {
    if (!status) return;
    const result = actions.updateMany(picked, { [status.id]: optionId });
    if (result.ok) clear();
    else toast.error("Couldn't update all of them", { description: result.message });
  };

  const total = (f: Field, list: DataRecord[]) => {
    if (displayKind(blueprint, f) !== "rating")
      return list.reduce((sum, r) => sum + (Number(r.data[f.id]) || 0), 0);
    const rated = list.map((r) => Number(r.data[f.id])).filter((n) => n > 0);
    return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
  };
  const formatTotal = (f: Field, value: number) => {
    const kind = displayKind(blueprint, f);
    if (kind === "money") return formatMoney(value, { currency: currencyOf(blueprint) });
    if (kind === "duration") return formatDuration(value);
    if (kind === "rating") return value ? `${formatNumber(Math.round(value * 10) / 10)} avg` : "";
    return formatNumber(value);
  };

  const toggleSort = (fieldId: string) =>
    setSort((s) =>
      s?.[0]?.fieldId === fieldId && s[0].dir === "asc"
        ? [{ fieldId, dir: "desc" }]
        : [{ fieldId, dir: "asc" }],
    );

  const pad = (i: number) => cn(i === 0 && !editable && "pl-5", i === fields.length - 1 && "pr-5");
  const renderRow = (row: DataRecord) => (
    <TableRow
      key={row.id}
      tabIndex={0}
      data-state={selected.has(row.id) ? "selected" : undefined}
      onClick={() => openRecord(row.id)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openRecord(row.id)}
      className={cn(
        "group/row h-10 cursor-default outline-none focus-visible:bg-muted",
        fresh[row.id] && "animate-flash",
      )}
    >
      {editable ? (
        <TableCell className="w-10 pl-5" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected.has(row.id)}
            onCheckedChange={() => toggle(row.id)}
            aria-label={`Select ${recordTitle(entity, row)}`}
          />
        </TableCell>
      ) : null}
      {fields.map((field, i) => (
        <TableCell
          key={field.id}
          className={cn(
            "max-w-[280px] truncate py-2",
            pad(i),
            i === 0 && "font-medium",
            numeric(field) && "text-right",
            inlineEdit && canEditInline(field) && "relative",
          )}
        >
          {field.type === "status" ? (
            <StatusMenu record={row} field={field} />
          ) : inlineEdit && canEditInline(field) && i === 0 ? (
            // The first cell is editable too, so the row gets its own button to open the record.
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1">
                <EditableCell record={row} field={field} />
              </span>
              <button
                type="button"
                aria-label={`Open ${recordTitle(entity, row)}`}
                title="Open"
                onClick={(e) => {
                  e.stopPropagation();
                  openRecord(row.id);
                }}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color] duration-150 group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <ArrowsOutSimpleIcon className="size-3.5" />
              </button>
            </span>
          ) : inlineEdit && canEditInline(field) ? (
            <EditableCell record={row} field={field} />
          ) : (
            <FieldValue field={field} value={row.data[field.id]} />
          )}
        </TableCell>
      ))}
    </TableRow>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToolbar>
        {picked.length ? (
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Selected rows">
            <span className="text-[13px] font-medium tabular">{picked.length} selected</span>
            {status?.options?.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                  Set {status.name.toLowerCase()}
                  <CaretDownIcon data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    {status.options.map((o) => (
                      <DropdownMenuItem key={o.id} onClick={() => setStatus(o.id)}>
                        {o.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCsv(rows.filter((r) => selected.has(r.id)))}
            >
              <DownloadSimpleIcon data-icon="inline-start" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => {
                actions.removeMany(picked, picked.length === 1 ? entity.name.toLowerCase() : plural);
                clear();
              }}
            >
              <TrashIcon data-icon="inline-start" />
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear selection">
              <XIcon />
            </Button>
          </div>
        ) : (
          <>
            <SearchInput value={query} onChange={setQuery} placeholder={`Search ${plural}`} />
            {codes.length ? (
              <Button variant="outline" size="sm" onClick={() => setScanning(true)}>
                <BarcodeIcon data-icon="inline-start" />
                Scan
              </Button>
            ) : null}
            {groupable.length ? (
              <Select
                value={groupBy}
                onValueChange={(v) => {
                  setGroupBy(String(v));
                  setCollapsed(new Set());
                }}
                items={{
                  [NO_GROUP]: "No grouping",
                  ...Object.fromEntries(groupable.map((f) => [f.id, `Group by ${f.name.toLowerCase()}`])),
                }}
              >
                <SelectTrigger size="sm" className="w-[176px]" aria-label="Group rows">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value={NO_GROUP}>No grouping</SelectItem>
                    {groupable.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        Group by {f.name.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
            {editable ? <ViewPrefToggle pref="inlineEdit" label="Edit in cells" /> : null}
            {inlineEdit ? (
              <span className="hidden text-[12px] text-muted-foreground/70 xl:inline">
                Double-click a cell to edit
              </span>
            ) : null}
            {editable && ws.mode === "live" ? (
              <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>
                <FileArrowUpIcon data-icon="inline-start" />
                Import
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!rows.length} />}>
                <DownloadSimpleIcon data-icon="inline-start" />
                Export
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void allRows().then(exportCsv)}>CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void allRows().then(exportXlsx)}>
                    Excel (.xlsx)
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ToolbarSummary>
              {count.toLocaleString("en-PH")} {count === 1 ? entity.name.toLowerCase() : plural}
              {/* Staff and viewers who see only their own records are told so, so a short list isn't a surprise. */}
              {entity.access && (ws.role === "staff" || ws.role === "viewer")
                ? entity.access.by === "created_by"
                  ? " · only the ones you added"
                  : " · only the ones assigned to you"
                : null}
            </ToolbarSummary>
          </>
        )}
      </ViewToolbar>
      {editable && ws.mode === "live" ? (
        <ImportDialog open={importing} onOpenChange={setImporting} entityId={entity.id} />
      ) : null}
      {codes.length ? (
        <ScanDialog
          open={scanning}
          onOpenChange={setScanning}
          title={`Find a ${entity.name.toLowerCase()}`}
          description={`Scan its ${codes[0].name.toLowerCase()} with the camera or a handheld scanner to open it.`}
          onScan={onScan}
        />
      ) : null}
      {ws.mode === "live" ? <SheetSyncBar entityId={entity.id} /> : null}
      {windowed && !server ? (
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">Loading {plural}…</p>
      ) : count === 0 ? (
        <ViewEmpty
          title={query ? "No matches" : `No ${plural} yet`}
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
                {editable ? (
                  <TableHead className="w-10 pl-5">
                    <Checkbox
                      checked={allPicked}
                      indeterminate={picked.length > 0 && !allPicked}
                      onCheckedChange={() => (allPicked ? clear() : setSelected(new Set(visibleIds)))}
                      aria-label={allPicked ? "Clear selection" : `Select all ${rows.length}`}
                    />
                  </TableHead>
                ) : null}
                {fields.map((field, i) => {
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
                        pad(i),
                        numeric(field) && "text-right",
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
                          numeric(field) && "flex-row-reverse",
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
              {groups
                ? groups.map((group) => {
                    const open = !collapsed.has(group.key);
                    // On a later page, only the groups with rows there (and closed ones, to open them) show.
                    if (paged && open && !group.rows.some((r) => onPage.has(r.id))) return null;
                    return (
                      <Fragment key={group.key || "__empty"}>
                        <TableRow className="h-9 bg-muted/30 hover:bg-muted/50">
                          <TableCell
                            colSpan={editable ? 2 : 1}
                            className={cn("py-1.5", editable ? "pl-5" : "pl-5")}
                          >
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() =>
                                setCollapsed((s) => {
                                  const next = new Set(s);
                                  next.has(group.key) ? next.delete(group.key) : next.add(group.key);
                                  return next;
                                })
                              }
                              className="inline-flex items-center gap-1.5 rounded-sm text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              {open ? (
                                <CaretDownIcon className="size-3" />
                              ) : (
                                <CaretRightIcon className="size-3" />
                              )}
                              {group.label}
                              <span className="font-normal text-muted-foreground tabular">
                                {(serverGroup(group.key)?.count ?? group.rows.length).toLocaleString("en-PH")}
                              </span>
                            </button>
                          </TableCell>
                          {fields.slice(1).map((field, i) => (
                            <TableCell
                              key={field.id}
                              className={cn(
                                "py-1.5 font-mono text-[12px] text-muted-foreground tabular",
                                numeric(field) && "text-right",
                                i === fields.length - 2 && "pr-5",
                              )}
                            >
                              {view.totals && summable(field)
                                ? formatTotal(
                                    field,
                                    serverGroup(group.key)?.totals[field.id] ?? total(field, group.rows),
                                  )
                                : null}
                            </TableCell>
                          ))}
                        </TableRow>
                        {open ? shownRows(group.rows).map(renderRow) : null}
                      </Fragment>
                    );
                  })
                : shownRows(rows).map(renderRow)}
            </TableBody>
            {view.totals && fields.some(summable) ? (
              <TableFooter className="sticky bottom-0 bg-background">
                <TableRow className="h-10 hover:bg-transparent">
                  {editable ? <TableCell className="pl-5" /> : null}
                  {fields.map((field, i) => (
                    <TableCell
                      key={field.id}
                      className={cn(
                        "py-2",
                        pad(i),
                        i === 0 && "font-medium",
                        numeric(field) && "text-right font-mono text-[12.5px] font-medium tabular",
                      )}
                    >
                      {i === 0
                        ? "Total"
                        : summable(field)
                          ? formatTotal(field, server ? (server.totals[field.id] ?? 0) : total(field, rows))
                          : null}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
          {paged ? (
            <nav
              aria-label="Pages"
              className="flex items-center justify-end gap-3 border-t px-5 py-2.5 text-[12.5px] text-muted-foreground"
            >
              <span className="tabular">
                {(page * PAGE_SIZE + 1).toLocaleString("en-PH")}–
                {Math.min((page + 1) * PAGE_SIZE, count).toLocaleString("en-PH")} of{" "}
                {count.toLocaleString("en-PH")}
              </span>
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => goTo(page - 1)}>
                <CaretLeftIcon data-icon="inline-start" />
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => goTo(page + 1)}>
                Next
                <CaretRightIcon data-icon="inline-end" />
              </Button>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
