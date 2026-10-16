"use client";

import {
  ArrowLeftIcon,
  FileArrowUpIcon,
  GoogleDriveLogoIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Entity } from "@/lib/blueprint/types";
import { downloadText, fileSlug } from "@/lib/download";
import { isOn } from "@/lib/engine/automations";
import {
  entityFromTable,
  type ImportPreview,
  importable,
  previewImport,
  suggestMapping,
  type Table,
  withNewType,
} from "@/lib/engine/import";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

type Sheet = Table & { name: string; truncated: boolean };
const NEW = "__new";
const SKIP = "__skip";
/** Leave room under the 4 MB save limit for the rest of the save. */
const MAX_PLAN_BYTES = 3_500_000;
const TYPE_LABEL: Record<string, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  money: "Money",
  percent: "Percent",
  date: "Date",
  datetime: "Date and time",
  checkbox: "Yes / no",
  select: "Choice",
  status: "Status",
  email: "Email",
  phone: "Phone",
  url: "Link",
};
const count = (n: number) => n.toLocaleString("en-PH");
/** Running automations saves rows one at a time; past this many, an import adds them without. */
const MAX_RUN_ROWS = 1000;

/**
 * Brings a CSV file, an Excel workbook or a shared Google Sheet into a record type: read it on the server, match its
 * columns to fields (by name, then Ask EveryOps for the rest), check every row the way a save does, then apply it as
 * one change in History that undoes in one step. Owners and admins can also add missing choices or make a new record
 * type from the sheet.
 */
export function ImportDialog({
  open,
  onOpenChange,
  entityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const manager = canManage(ws.role);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [source, setSource] = useState("");
  const [sheetAt, setSheetAt] = useState(0);
  const [target, setTarget] = useState(entityId);
  const [newName, setNewName] = useState("");
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [aiMatched, setAiMatched] = useState<Set<number>>(new Set());
  const [matching, setMatching] = useState(false);
  const [matchFieldId, setMatchFieldId] = useState<string | null>(null);
  const [onMatch, setOnMatch] = useState<"update" | "skip">("update");
  const [addOptions, setAddOptions] = useState(manager);
  const [createLinked, setCreateLinked] = useState(true);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [runAutomations, setRunAutomations] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const sheet = sheets?.[sheetAt] ?? null;
  const entity = ws.blueprint.entities.find((e) => e.id === entityId) as Entity;

  // Starting over each time it opens.
  useEffect(() => {
    if (!open) return;
    setSheets(null);
    setError(null);
    setLink("");
    setTarget(entityId);
  }, [open, entityId]);

  // A new record type from the sheet, made fresh whenever the sheet or its name changes.
  const fresh = useMemo(() => {
    if (!sheet || target !== NEW) return null;
    const taken = new Set(ws.blueprint.entities.map((e) => e.id));
    const made = entityFromTable(newName || sheet.name || "Imported records", sheet, taken);
    return { ...made, design: withNewType(ws.blueprint, made.entity) };
  }, [sheet, target, newName, ws.blueprint]);
  const into = fresh ? fresh.entity : (ws.blueprint.entities.find((e) => e.id === target) ?? entity);

  // Columns matched by name whenever the sheet or the record type changes; Ask EveryOps then fills the gaps.
  useEffect(() => {
    if (!sheet) return;
    setAiMatched(new Set());
    setMatching(false);
    setDefaults({});
    if (fresh) {
      setMapping(fresh.mapping);
      setMatchFieldId(null);
      return;
    }
    const byName = suggestMapping(into, sheet.headers);
    setMapping(byName);
    setMatchFieldId(byName.includes(into.primaryFieldId) ? into.primaryFieldId : null);
    const open = byName
      .map((id, index) => ({ id, index }))
      .filter((c) => !c.id && sheet.rows.some((r) => r[c.index]?.trim()));
    if (!open.length || ws.mode !== "live") return;
    let live = true;
    setMatching(true);
    const fields = into.fields.filter(importable).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      ...(f.options?.length ? { options: f.options.map((o) => o.label) } : {}),
    }));
    fetch("/api/ai/import-map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityName: into.pluralName,
        fields,
        columns: open.map((c) => ({
          index: c.index,
          header: sheet.headers[c.index],
          samples: sheet.rows
            .map((r) => r[c.index] ?? "")
            .filter(Boolean)
            .slice(0, 5),
        })),
        taken: byName.filter(Boolean),
        workspaceId: ws.id,
      }),
    })
      .then((r) => r.json())
      .then((body: { ok: boolean; mapping?: Record<string, string> }) => {
        if (!live || !body.ok || !body.mapping) return;
        const found = Object.entries(body.mapping).map(([i, id]) => [Number(i), id] as const);
        if (!found.length) return;
        setMapping((m) => {
          const next = [...m];
          for (const [i, id] of found) if (!next[i] && !next.includes(id)) next[i] = id;
          return next;
        });
        setAiMatched(new Set(found.map(([i]) => i)));
      })
      .catch(() => {})
      .finally(() => live && setMatching(false));
    return () => {
      live = false;
      setMatching(false);
    };
  }, [sheet, into, fresh, ws.mode, ws.id]);

  const preview: (ImportPreview & { systemId?: string }) | null = useMemo(() => {
    if (!sheet || !mapping.length) return null;
    const data = fresh
      ? { blueprint: fresh.design.blueprint, records: ws.records }
      : { blueprint: ws.blueprint, records: ws.records };
    const p = previewImport(data, into.id, sheet, {
      mapping,
      matchFieldId,
      onMatch,
      addOptions: manager && addOptions,
      createLinked,
      defaults,
    });
    if (!fresh) return runAutomations ? { ...p, plan: { ...p.plan, runAutomations: true } } : p;
    return {
      ...p,
      systemId: fresh.design.systemId,
      plan: {
        ...p.plan,
        title: `Import ${p.counts.create} ${into.pluralName.toLowerCase()} as a new record type`,
        ops: [...fresh.design.ops, ...p.plan.ops],
        steps: [
          { kind: "add", label: into.pluralName, detail: "New record type and page from the sheet" },
          ...p.plan.steps,
        ],
        baseVersion: ws.blueprint.version,
      },
    };
  }, [
    sheet,
    mapping,
    fresh,
    into,
    matchFieldId,
    onMatch,
    addOptions,
    createLinked,
    defaults,
    runAutomations,
    manager,
    ws.blueprint,
    ws.records,
  ]);

  const read = async (request: Promise<Response>, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await request;
      const body = (await res.json()) as { ok: boolean; sheets?: Sheet[]; message?: string };
      if (!body.ok || !body.sheets?.length) throw new Error(body.message ?? "That file couldn't be read.");
      setSheets(body.sheets);
      setSheetAt(0);
      setSource(name);
      setNewName(body.sheets[0].name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    } catch (e) {
      setError((e as Error).message || "That file couldn't be read.");
    } finally {
      setBusy(false);
    }
  };
  const url = `/api/workspaces/${encodeURIComponent(ws.id)}/import`;
  const readFile = (file: File) => {
    const form = new FormData();
    form.append("file", file);
    void read(fetch(url, { method: "POST", body: form }), file.name);
  };
  const readLink = () =>
    void read(
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link }),
      }),
      "Google Sheet",
    );

  const template = () => {
    const fields = entity.fields.filter(importable);
    downloadText(
      `${fileSlug(entity.pluralName)}-template.csv`,
      `${fields.map((f) => f.name).join(",")}\n`,
      "text/csv",
    );
  };

  const problemsCsv = () => {
    if (!sheet || !preview) return;
    const cell = (t: string) => (/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    const bad = preview.rows.filter((r) => r.action === "error");
    const lines = [[...sheet.headers, "Problem"].map(cell).join(",")];
    for (const r of bad)
      lines.push([...(sheet.rows[r.row - 2] ?? []), r.problems.join("; ")].map(cell).join(","));
    downloadText(`${fileSlug(source)}-problems.csv`, lines.join("\n"), "text/csv");
  };

  const apply = () => {
    if (!preview) return;
    if (JSON.stringify(preview.plan).length > MAX_PLAN_BYTES) {
      setError(
        "That's more than one save can hold. Split the sheet into smaller files and import them one by one.",
      );
      return;
    }
    const entry = applyChange(ws.id, preview.plan);
    if (!entry) {
      setError("The import couldn't be applied. Reload the workspace and try again.");
      return;
    }
    const done = preview.counts.create + preview.counts.update;
    const noun = done === 1 ? into.name.toLowerCase() : into.pluralName.toLowerCase();
    toast.success(`Imported ${count(done)} ${noun}`, {
      description: preview.counts.error
        ? preview.counts.error === 1
          ? "1 row with a problem was left out."
          : `${count(preview.counts.error)} rows with problems were left out.`
        : "Saved to History, where you can undo it.",
      action: { label: "Undo", onClick: () => undoChange(ws.id, entry.id) },
    });
    onOpenChange(false);
    if (preview.systemId) router.push(`${ws.basePath}/${preview.systemId}`);
  };

  const mapped = mapping.filter(Boolean).length;
  // Required fields with no column: one value for every row keeps them from failing.
  // Automations that run when this record type is saved. An import doesn't run them unless the owner asks.
  const automations = fresh
    ? []
    : ws.blueprint.rules.filter(
        (r) =>
          isOn(r) &&
          r.trigger.entityId === into.id &&
          ["created", "status_changed"].includes(r.trigger.event),
      );
  const tooManyToRun = (sheet?.rows.length ?? 0) > MAX_RUN_ROWS;
  const unfilled = into.fields.filter((f) => importable(f) && f.required && !mapping.includes(f.id));
  const ready = !!preview && preview.counts.create + preview.counts.update > 0 && (!fresh || newName.trim());
  const problems = preview?.rows.filter((r) => r.action === "error") ?? [];
  const optionNames = Object.entries(preview?.newOptions ?? {});
  const linkNames = Object.entries(preview?.missingLinks ?? {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,820px)] flex-col gap-0 p-0 sm:max-w-[780px]">
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle>
            {sheet
              ? `Import ${count(sheet.rows.length)} rows into ${into.pluralName}`
              : `Import ${entity.pluralName.toLowerCase()}`}
          </DialogTitle>
          <DialogDescription>
            {sheet
              ? `From ${source}${sheet.truncated ? " (the first 5,000 rows)" : ""}. Check how the columns match, then import. It's one change in History you can undo.`
              : "From a CSV or Excel file, or a Google Sheet. You'll see every row checked before anything is added."}
          </DialogDescription>
        </DialogHeader>

        {!sheet ? (
          <div className="flex flex-col gap-5 px-5 py-5">
            <label
              htmlFor="import-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) readFile(file);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-150",
                dragging ? "border-primary bg-primary/5" : "hover:border-foreground/25 hover:bg-muted/30",
              )}
            >
              <FileArrowUpIcon className="size-7 text-muted-foreground" />
              <span className="text-[14px] font-medium">
                {busy ? "Reading…" : "Drop a CSV or Excel file, or choose one"}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                .csv or .xlsx, up to 10 MB and 5,000 rows
              </span>
              <input
                ref={fileInput}
                id="import-file"
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <GoogleDriveLogoIcon className="size-4" /> Or a Google Sheet
              </span>
              <div className="flex gap-2">
                <Input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  aria-label="Google Sheets link"
                  onKeyDown={(e) => e.key === "Enter" && link.trim() && readLink()}
                />
                <Button variant="outline" disabled={!link.trim() || busy} onClick={readLink}>
                  Read sheet
                </Button>
              </div>
              <span className="text-[12px] text-muted-foreground">
                Share it as "Anyone with the link can view". The tab in the link is the one read.
              </span>
            </div>
            {error ? <ErrorNote message={error} /> : null}
            <button
              type="button"
              onClick={template}
              className="self-start text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Download a template with the {entity.pluralName.toLowerCase()} columns
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <div className="flex flex-wrap items-end gap-3">
              {sheets && sheets.length > 1 ? (
                <Labeled label="Sheet">
                  <Select
                    value={String(sheetAt)}
                    onValueChange={(v) => setSheetAt(Number(v))}
                    items={Object.fromEntries(sheets.map((s, i) => [String(i), s.name]))}
                  >
                    <SelectTrigger size="sm" className="min-w-[150px]" aria-label="Sheet">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {sheets.map((s, i) => (
                          <SelectItem key={s.name} value={String(i)}>
                            {s.name} · {count(s.rows.length)} rows
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Labeled>
              ) : null}
              <Labeled label="Import into">
                <Select
                  value={target}
                  onValueChange={(v) => setTarget(String(v))}
                  items={{
                    ...Object.fromEntries(
                      ws.blueprint.entities.filter((e) => !e.parent).map((e) => [e.id, e.pluralName]),
                    ),
                    [NEW]: "A new record type",
                  }}
                >
                  <SelectTrigger size="sm" className="min-w-[180px]" aria-label="Import into">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      {ws.blueprint.entities
                        .filter((e) => !e.parent)
                        .map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.pluralName}
                          </SelectItem>
                        ))}
                      {manager ? <SelectItem value={NEW}>A new record type</SelectItem> : null}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Labeled>
              {fresh ? (
                <Labeled label="Name">
                  <Input
                    className="h-7 w-[200px] text-[13px]"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    aria-label="New record type name"
                    placeholder="e.g. Members"
                  />
                </Labeled>
              ) : null}
              <button
                type="button"
                className="ml-auto text-[12.5px] text-muted-foreground hover:text-foreground"
                onClick={() => setSheets(null)}
              >
                Choose another file
              </button>
            </div>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-medium">
                  Columns{" "}
                  <span className="font-normal text-muted-foreground">
                    · {mapped} of {sheet.headers.length} matched
                  </span>
                </h3>
                {matching ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <SparkleIcon className="size-3.5 animate-pulse" /> Ask EveryOps is matching the rest…
                  </span>
                ) : aiMatched.size ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-primary">
                    <SparkleIcon className="size-3.5" /> Ask EveryOps matched {aiMatched.size} by their values
                  </span>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-lg border">
                {sheet.headers
                  .map((h, n) => ({ header: h, i: n, key: `col${n}` }))
                  .map(({ header, i, key }) => {
                    const sample = sheet.rows
                      .map((r) => r[i] ?? "")
                      .filter(Boolean)
                      .slice(0, 3);
                    const value = mapping[i] ?? SKIP;
                    const field = into.fields.find((f) => f.id === mapping[i]);
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_200px] items-center gap-3 border-b px-3 py-2 last:border-b-0"
                      >
                        <span className="truncate text-[13px] font-medium">{header}</span>
                        <span className="truncate text-[12.5px] text-muted-foreground">
                          {sample.join(" · ") || "Empty"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={value}
                            onValueChange={(v) => {
                              const id = v === SKIP ? null : String(v);
                              setMapping((m) => m.map((x, j) => (j === i ? id : x === id && id ? null : x)));
                              setAiMatched((s) => {
                                const next = new Set(s);
                                next.delete(i);
                                return next;
                              });
                            }}
                            items={{
                              [SKIP]: "Skip this column",
                              ...Object.fromEntries(
                                into.fields
                                  .filter(importable)
                                  .map((f) => [
                                    f.id,
                                    fresh ? `${f.name} · ${TYPE_LABEL[f.type] ?? f.type}` : f.name,
                                  ]),
                              ),
                            }}
                          >
                            <SelectTrigger
                              size="sm"
                              className={cn("w-full", !mapping[i] && "text-muted-foreground")}
                              aria-label={`Field for ${header}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectGroup>
                                <SelectItem value={SKIP}>Skip this column</SelectItem>
                                {into.fields.filter(importable).map((f) => (
                                  <SelectItem key={f.id} value={f.id}>
                                    {f.name}
                                    {fresh ? (
                                      <span className="text-muted-foreground">
                                        {" "}
                                        · {TYPE_LABEL[f.type] ?? f.type}
                                      </span>
                                    ) : null}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {aiMatched.has(i) && field ? (
                            <SparkleIcon
                              className="size-3.5 shrink-0 text-primary"
                              aria-label="Matched by Ask EveryOps"
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>

            {unfilled.length ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-medium">
                  Not in the sheet{" "}
                  <span className="font-normal text-muted-foreground">
                    · required, so give every row a value
                  </span>
                </h3>
                <div className="overflow-hidden rounded-lg border">
                  {unfilled.map((f) => (
                    <div
                      key={f.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_200px] items-center gap-3 border-b px-3 py-2 last:border-b-0"
                    >
                      <span className="truncate text-[13px] font-medium">{f.name}</span>
                      <span className="truncate text-[12.5px] text-muted-foreground">
                        {f.options?.length
                          ? f.options
                              .map((o) => o.label)
                              .slice(0, 4)
                              .join(", ")
                          : f.type === "relation"
                            ? `The name of a ${ws.blueprint.entities.find((e) => e.id === f.relation?.entityId)?.name.toLowerCase() ?? "record"}`
                            : (TYPE_LABEL[f.type] ?? f.type)}
                      </span>
                      <Input
                        className="h-7 text-[13px]"
                        value={defaults[f.id] ?? ""}
                        onChange={(e) => setDefaults((d) => ({ ...d, [f.id]: e.target.value }))}
                        placeholder={
                          ["number", "money", "percent"].includes(f.type)
                            ? "0"
                            : f.type === "date"
                              ? "2026-10-16"
                              : "Value for every row"
                        }
                        aria-label={`Value of ${f.name} for every row`}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {!fresh ? (
              <section className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
                <span>Rows that match an existing {into.name.toLowerCase()} by</span>
                <Select
                  value={matchFieldId ?? SKIP}
                  onValueChange={(v) => setMatchFieldId(v === SKIP ? null : String(v))}
                  items={{
                    [SKIP]: "nothing (add every row)",
                    ...Object.fromEntries(
                      into.fields
                        .filter((f) => mapping.includes(f.id))
                        .map((f) => [f.id, f.name.toLowerCase()]),
                    ),
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Match existing records by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value={SKIP}>nothing (add every row)</SelectItem>
                      {into.fields
                        .filter((f) => mapping.includes(f.id))
                        .map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name.toLowerCase()}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {matchFieldId ? (
                  <Select
                    value={onMatch}
                    onValueChange={(v) => setOnMatch(v as "update" | "skip")}
                    items={{ update: "are updated", skip: "are skipped" }}
                  >
                    <SelectTrigger size="sm" aria-label="What matching rows do">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        <SelectItem value="update">are updated</SelectItem>
                        <SelectItem value="skip">are skipped</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : null}
              </section>
            ) : null}

            {optionNames.length || linkNames.length ? (
              <section className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 px-3.5 py-3">
                {optionNames.length ? (
                  <div className="flex items-start gap-2.5 text-[13px]">
                    <Checkbox
                      id="import-add-options"
                      checked={manager && addOptions}
                      disabled={!manager}
                      onCheckedChange={(v) => setAddOptions(!!v)}
                      className="mt-0.5"
                    />
                    <label htmlFor="import-add-options">
                      Add the new choices{" "}
                      {optionNames.map(([fieldId, labels]) => (
                        <span key={fieldId} className="text-muted-foreground">
                          {into.fields.find((f) => f.id === fieldId)?.name}: {labels.slice(0, 6).join(", ")}
                          {labels.length > 6 ? ` and ${labels.length - 6} more` : ""}.{" "}
                        </span>
                      ))}
                      {!manager ? (
                        <span className="text-muted-foreground">Only owners and admins can add choices.</span>
                      ) : null}
                    </label>
                  </div>
                ) : null}
                {linkNames.length ? (
                  <div className="flex items-start gap-2.5 text-[13px]">
                    <Checkbox
                      id="import-create-linked"
                      checked={createLinked}
                      onCheckedChange={(v) => setCreateLinked(!!v)}
                      className="mt-0.5"
                    />
                    <label htmlFor="import-create-linked">
                      Create the linked records the sheet names that don't exist yet{" "}
                      {linkNames.map(([eid, titles]) => (
                        <span key={eid} className="text-muted-foreground">
                          {ws.blueprint.entities.find((e) => e.id === eid)?.pluralName}:{" "}
                          {titles.slice(0, 6).join(", ")}
                          {titles.length > 6 ? ` and ${titles.length - 6} more` : ""}.{" "}
                        </span>
                      ))}
                    </label>
                  </div>
                ) : null}
              </section>
            ) : null}

            {automations.length ? (
              <section className="flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px]">
                <Checkbox
                  id="import-run-automations"
                  checked={runAutomations && !tooManyToRun}
                  disabled={tooManyToRun}
                  onCheckedChange={(v) => setRunAutomations(!!v)}
                  className="mt-0.5"
                />
                <label htmlFor="import-run-automations" className="flex flex-col gap-0.5">
                  <span>
                    Run automations for these rows{" "}
                    <span className="text-muted-foreground">
                      ({automations.map((a) => a.name).join(", ")})
                    </span>
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {tooManyToRun
                      ? `Only for imports of up to ${count(MAX_RUN_ROWS)} rows. These are added as past records.`
                      : "Off: they're added as past records, so nothing is emailed, counted or adjusted again."}
                  </span>
                </label>
              </section>
            ) : null}

            {preview ? (
              <section className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Count n={preview.counts.create} label="new" tone="good" />
                  <Count n={preview.counts.update} label="updated" tone="good" />
                  <Count n={preview.counts.skip} label="skipped" />
                  <Count n={preview.counts.error} label="with problems" tone="bad" />
                </div>
                {problems.length ? (
                  <div className="rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-2 text-[12.5px]">
                      <span className="font-medium">Rows that won't be imported</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={problemsCsv}
                      >
                        Download them with the reasons
                      </button>
                    </div>
                    <ul className="max-h-[180px] overflow-y-auto">
                      {problems.slice(0, 50).map((r) => (
                        <li
                          key={r.row}
                          className="flex gap-3 border-b px-3 py-1.5 text-[12.5px] last:border-b-0"
                        >
                          <span className="w-14 shrink-0 tabular text-muted-foreground">Row {r.row}</span>
                          <span className="min-w-0">{r.problems.join(" · ")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
            {error ? <ErrorNote message={error} /> : null}
          </div>
        )}

        {sheet ? (
          <DialogFooter className="mx-0 mb-0 border-t px-5 py-3.5">
            <Button variant="ghost" onClick={() => setSheets(null)}>
              <ArrowLeftIcon data-icon="inline-start" />
              Back
            </Button>
            <Button disabled={!ready} onClick={apply}>
              Import {count((preview?.counts.create ?? 0) + (preview?.counts.update ?? 0))}{" "}
              {into.pluralName.toLowerCase()}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: "good" | "bad" }) {
  if (!n && label !== "new") return null;
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[12.5px] tabular",
        tone === "good" && n
          ? "border-primary/30 text-primary"
          : tone === "bad"
            ? "border-destructive/30 text-destructive"
            : "text-muted-foreground",
      )}
    >
      {count(n)} {label}
    </span>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}
