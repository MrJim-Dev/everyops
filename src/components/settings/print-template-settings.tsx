"use client";

import { FileTextIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PrintPaper } from "@/components/print/print-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { recordTitle } from "@/lib/blueprint/lookup";
import type { PaperSize, PrintTemplate } from "@/lib/blueprint/types";
import { newId } from "@/lib/engine/ids";
import {
  lineEntities,
  PAPER_SIZES,
  placeholderOptions,
  renderPrint,
  starterTemplate,
  unknownPlaceholders,
} from "@/lib/engine/print";
import { canManage } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";
import { SettingsPage, SettingsSection } from "./settings-section";

const paperLabel = (p?: PaperSize) => PAPER_SIZES.find((s) => s.id === (p ?? "a4"))?.label ?? "A4";

/** Settings → Print templates: invoices, quotes and agreements that any record can print or save as a PDF. */
export function PrintTemplateSettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role) && ws.mode === "live";
  const applyChange = useWorkspaces((s) => s.applyChange);
  const templates = ws.blueprint.printTemplates ?? [];
  const [editing, setEditing] = useState<PrintTemplate | null>(null);
  const entityName = (id: string) => ws.blueprint.entities.find((e) => e.id === id)?.name ?? "Missing type";

  const startNew = () => {
    const entity = ws.blueprint.entities.find((e) => !e.parent) ?? ws.blueprint.entities[0];
    if (!entity) return;
    setEditing({
      id: newId("print"),
      entityId: entity.id,
      name: entity.name,
      body: starterTemplate(ws.blueprint, entity),
      paper: "a4",
    });
  };

  const save = (template: PrintTemplate) => {
    const exists = templates.some((t) => t.id === template.id);
    const entry = applyChange(ws.id, {
      request: `${exists ? "Change" : "Add"} the ${template.name} print template`,
      title: `${exists ? "Changed" : "Added"} print template ${template.name}`,
      facts: [],
      steps: [
        {
          kind: exists ? "change" : "add",
          label: template.name,
          detail: `Prints ${entityName(template.entityId).toLowerCase()} records`,
        },
      ],
      ops: [{ op: "add_print_template", template }],
    });
    if (!entry) {
      toast.error("Couldn't save the template");
      return;
    }
    toast.success(`${template.name} saved`, { description: "Print it from any record's ⋯ menu." });
    setEditing(null);
  };

  const remove = (template: PrintTemplate) => {
    const entry = applyChange(ws.id, {
      request: `Remove the ${template.name} print template`,
      title: `Removed print template ${template.name}`,
      facts: [],
      steps: [{ kind: "remove", label: template.name, detail: "No longer offered for printing" }],
      ops: [{ op: "remove_print_template", templateId: template.id }],
    });
    if (entry) toast.success(`${template.name} removed`, { description: "Undo it from History." });
  };

  return (
    <SettingsPage>
      <SettingsSection
        title="Print templates"
        description="Invoices, quotes, receipts and agreements, filled in from a record. Open a record, choose ⋯ and print it or save it as a PDF."
        footer={
          templates.length ? `${templates.length} template${templates.length === 1 ? "" : "s"}` : undefined
        }
        action={
          manager ? (
            <Button size="sm" onClick={startNew} disabled={!ws.blueprint.entities.length}>
              <PlusIcon data-icon="inline-start" />
              New template
            </Button>
          ) : undefined
        }
      >
        {templates.length ? (
          <ul className="-mx-5 -mb-5 divide-y divide-foreground/[0.06] border-t border-foreground/[0.06]">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13.5px] font-medium">{t.name}</span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {entityName(t.entityId)} · {paperLabel(t.paper)}
                  </span>
                </div>
                {manager ? (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      <PencilSimpleIcon data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${t.name}`}
                      onClick={() => remove(t)}
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No templates yet. Every record can already print a plain summary; add a template to lay out an
            invoice, a quote or an agreement in your own words.
          </p>
        )}
      </SettingsSection>
      {editing ? (
        <TemplateEditor
          key={editing.id}
          initial={editing}
          isNew={!templates.some((t) => t.id === editing.id)}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </SettingsPage>
  );
}

function TemplateEditor({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: PrintTemplate;
  isNew: boolean;
  onCancel: () => void;
  onSave: (template: PrintTemplate) => void;
}) {
  const { blueprint, records } = useWorkspace();
  const [draft, setDraft] = useState<PrintTemplate>(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  const entity = blueprint.entities.find((e) => e.id === draft.entityId);
  const samples = useMemo(() => {
    // Records with line items first (an invoice previews with its table), newest first.
    const children = entity ? lineEntities(blueprint, entity) : [];
    const withLines = new Set<unknown>();
    for (const r of records)
      for (const c of children) if (r.entityId === c.id) withLines.add(r.data[c.parent?.fieldId ?? ""]);
    return records
      .filter((r) => r.entityId === draft.entityId)
      .sort(
        (a, b) =>
          Number(withLines.has(b.id)) - Number(withLines.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, 50);
  }, [records, blueprint, entity, draft.entityId]);
  const [sampleId, setSampleId] = useState<string>("");
  const sample = samples.find((r) => r.id === sampleId) ?? samples[0];
  const options = entity ? placeholderOptions(blueprint, entity) : [];
  const groups = [...new Set(options.map((o) => o.group))];
  const unknown = entity ? unknownPlaceholders(blueprint, entity, draft.body) : [];
  const preview = sample ? renderPrint(blueprint, draft, sample, records) : "";

  const changeEntity = (entityId: string) => {
    const next = blueprint.entities.find((e) => e.id === entityId);
    if (!next) return;
    // A new template follows the record type; one already written keeps its words.
    setDraft((d) => ({
      ...d,
      entityId,
      ...(isNew ? { name: next.name, body: starterTemplate(blueprint, next) } : {}),
    }));
    setSampleId("");
  };

  const insert = (token: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : draft.body.length;
    const end = el ? el.selectionEnd : at;
    const body = draft.body.slice(0, at) + token + draft.body.slice(end);
    setDraft((d) => ({ ...d, body }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const valid = !!draft.name.trim() && !!entity && !!draft.body.trim();

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[min(92dvh,940px)] flex-col gap-4 sm:max-w-[1120px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "New print template" : `Edit ${initial.name}`}</DialogTitle>
          <DialogDescription>
            Write it like a document. Words in double braces are filled in from the record when it prints.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <div className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="print-name">Name</Label>
                <Input
                  id="print-name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Invoice"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="print-entity">Prints</Label>
                <NativeSelect
                  id="print-entity"
                  className="w-full"
                  value={draft.entityId}
                  onChange={(e) => changeEntity(e.target.value)}
                >
                  {blueprint.entities.map((e) => (
                    <NativeSelectOption key={e.id} value={e.id}>
                      {e.pluralName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="print-paper">Paper</Label>
                <NativeSelect
                  id="print-paper"
                  className="w-full"
                  value={draft.paper ?? "a4"}
                  onChange={(e) => setDraft((d) => ({ ...d, paper: e.target.value as PaperSize }))}
                >
                  {PAPER_SIZES.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="print-body">Template</Label>
              <Textarea
                id="print-body"
                ref={area}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                className="min-h-[280px] font-mono text-[12.5px] leading-relaxed"
                spellCheck={false}
              />
              {unknown.length ? (
                <p className="flex items-start gap-1.5 text-[12.5px] text-warning">
                  <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
                  {unknown.map((u) => `{{${u}}}`).join(", ")}{" "}
                  {unknown.length === 1
                    ? "doesn't match a field and prints blank."
                    : "don't match a field and print blank."}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">Insert</span>
              {groups.map((g) => (
                <div key={g} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-full text-[11.5px] text-muted-foreground/80">{g}</span>
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <button
                        key={o.token}
                        type="button"
                        onClick={() => insert(o.token)}
                        title={o.token}
                        className="rounded-md border bg-secondary/40 px-2 py-0.5 text-[12px] transition-colors hover:bg-secondary active:scale-[0.97]"
                      >
                        {o.label}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">Preview</span>
              {samples.length ? (
                <NativeSelect
                  size="sm"
                  aria-label="Preview with"
                  value={sample?.id ?? ""}
                  onChange={(e) => setSampleId(e.target.value)}
                >
                  {entity
                    ? samples.map((r) => (
                        <NativeSelectOption key={r.id} value={r.id}>
                          {recordTitle(entity, r)}
                        </NativeSelectOption>
                      ))
                    : null}
                </NativeSelect>
              ) : null}
            </div>
            <div className="min-h-[240px] flex-1 overflow-y-auto rounded-lg bg-muted/40 p-4">
              {sample ? (
                <PrintPaper markdown={preview} paper={draft.paper} />
              ) : (
                <p className="p-4 text-[13px] text-muted-foreground">
                  Add a {entity?.name.toLowerCase() ?? "record"} to see the preview.
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
            {isNew ? "Add template" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
