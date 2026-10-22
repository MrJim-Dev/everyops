"use client";

import { DotsThreeIcon, PencilSimpleIcon, PlusIcon, PrinterIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { PrintDialog } from "@/components/print/print-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import { editableFields, statusField } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, PrintTemplate, RecordData } from "@/lib/blueprint/types";
import { findDuplicates } from "@/lib/engine/duplicates";
import { renderPrint, starterTemplate, templatesFor } from "@/lib/engine/print";
import type { FieldError } from "@/lib/engine/records";
import { formatDateTime } from "@/lib/format";
import { loadAll } from "@/lib/store/server-records";
import { canEdit, useWorkspaces } from "@/lib/store/workspaces";
import { FieldValue } from "./field-value";
import { MergeDialog } from "./merge-dialog";
import { RecordFieldsForm } from "./record-fields-form";
import { useRecordPanels } from "./record-panels";
import { StatusMenu } from "./status-menu";

/** Line items a panel lists before "Show more". */
const LINES_SHOWN = 50;

/**
 * One record: properties, its line items, and the next sensible action. A drawer from the right; while the
 * assistant panel sits on the right, a centered modal instead, so neither covers the other.
 */
export function RecordSheet({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const { records, blueprint } = useWorkspace();
  const assistantOpen = useAssistant((s) => s.open);
  const record = recordId ? findRecord(records, recordId) : undefined;
  const entity = record ? findEntity(blueprint, record.entityId) : undefined;
  const body =
    record && entity ? (
      <RecordSheetBody key={record.id} record={record} entity={entity} onClose={onClose} />
    ) : null;

  if (assistantOpen)
    return (
      <Dialog open={!!record} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[min(85dvh,760px)] flex-col gap-0 p-0 sm:max-w-[560px]">
          {body}
        </DialogContent>
      </Dialog>
    );
  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-[480px]">{body}</SheetContent>
    </Sheet>
  );
}

function RecordSheetBody({
  record,
  entity,
  onClose,
}: {
  record: DataRecord;
  entity: Entity;
  onClose: () => void;
}) {
  const { blueprint, records, role, id: workspaceId, mode } = useWorkspace();
  const { openCreate, openRecord } = useRecordPanels();
  const editable = canEdit(role);
  const actions = useRecordActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RecordData>(record.data);
  // The record as it was when editing started; only fields that differ from it are saved.
  const [base, setBase] = useState<RecordData>(record.data);
  const [errors, setErrors] = useState<FieldError[]>([]);
  // Another record with this phone or email: the same customer added twice.
  const twins = useMemo(
    () => findDuplicates(entity, record.data, records, record.id),
    [entity, record, records],
  );
  const [merging, setMerging] = useState<DataRecord | null>(null);
  const [printing, setPrinting] = useState<PrintTemplate | null>(null);
  // Line items drawn per type before "Show more": a player with 1,700 bookings would draw them all.
  const [linesShown, setLinesShown] = useState<Record<string, number>>({});
  // The record type's print templates; without any, one built from its fields so every record can print.
  const printables = useMemo(() => {
    const own = templatesFor(blueprint, entity.id);
    return own.length
      ? own
      : [{ id: "default", entityId: entity.id, name: entity.name, body: starterTemplate(blueprint, entity) }];
  }, [blueprint, entity]);
  const status = statusField(entity);
  const current = status ? optionOf(status, record.data[status.id]) : undefined;
  // The next sensible step is the first "success" option the record isn't in yet (e.g. Paid, Approved).
  const next = status?.options?.find((o) => o.tone === "success" && o.id !== current?.id);
  const children = blueprint.entities.filter((e) => e.parent?.entityId === entity.id);
  // Line items of a windowed type (src/lib/engine/window.ts) that are older than this copy's window: read from the
  // server when the record opens, so the panel lists all of them.
  const windowed = useWorkspaces((s) => s.workspaces[workspaceId]?.windowed);
  const windowedChildren =
    mode === "live"
      ? children
          .filter((c) => windowed?.[c.id])
          .map((c) => c.id)
          .join(",")
      : "";
  useEffect(() => {
    if (!windowedChildren) return;
    for (const id of windowedChildren.split(",")) {
      const child = blueprint.entities.find((e) => e.id === id);
      if (child?.parent)
        void loadAll(workspaceId, { entityId: id, field: child.parent.fieldId, equals: record.id });
    }
  }, [windowedChildren, workspaceId, record.id, blueprint]);

  const startEditing = () => {
    setDraft(record.data);
    setBase(record.data);
    setEditing(true);
  };

  const save = () => {
    // Only what was edited. A status changed from the pill or "Mark as" while the panel was open isn't written
    // back over: confirming a pre-order and then entering its deposit once put it back to Pending payment and
    // returned its cake to stock.
    const edited = Object.fromEntries(
      Object.entries(draft).filter(([id, value]) => JSON.stringify(value) !== JSON.stringify(base[id])),
    );
    const result = actions.update(record.id, edited);
    if (result.ok) {
      setEditing(false);
      setErrors([]);
    } else setErrors(result.errors);
  };

  return (
    <>
      <SheetHeader className="gap-2 border-b px-5 pb-4 pt-5">
        <SheetDescription className="text-[12px]">{entity.name}</SheetDescription>
        <div className="flex items-center gap-2 pr-8">
          <SheetTitle className="truncate text-[17px] font-semibold">
            {recordTitle(entity, record)}
          </SheetTitle>
          {status ? <StatusMenu record={record} field={status} pill /> : null}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!editing && twins.length ? (
          <div
            aria-live="polite"
            className="mb-4 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12.5px]"
          >
            {twins.slice(0, 3).map((t) => (
              <div key={t.record.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  Possible duplicate:{" "}
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() => openRecord(t.record.id)}
                  >
                    {recordTitle(entity, t.record)}
                  </button>{" "}
                  <span className="text-muted-foreground">has the same {t.field.name.toLowerCase()}</span>
                </span>
                {editable ? (
                  <Button size="sm" variant="outline" onClick={() => setMerging(t.record)}>
                    Merge…
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {editing ? (
          <RecordFieldsForm
            entity={entity}
            values={draft}
            errors={errors}
            idPrefix={`edit-${record.id}`}
            onChange={(fieldId, value) => setDraft((d) => ({ ...d, [fieldId]: value }))}
          />
        ) : (
          // Values wrap (long notes keep their line breaks) instead of widening the panel past its edge.
          <dl className="grid grid-cols-[minmax(96px,32%)_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
            {entity.fields
              .filter((f) => f.id !== entity.primaryFieldId && f.id !== status?.id)
              .map((field) => (
                <div key={field.id} className="contents">
                  <dt className="text-muted-foreground">{field.name}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere] [&_.truncate]:whitespace-pre-line">
                    <FieldValue
                      field={field}
                      value={record.data[field.id]}
                      className={field.type === "image" ? "size-40" : undefined}
                    />
                  </dd>
                </div>
              ))}
          </dl>
        )}

        {!editing &&
          children.map((child) => {
            const parentField = child.parent?.fieldId ?? "";
            const lines = records.filter((r) => r.entityId === child.id && r.data[parentField] === record.id);
            if (!lines.length && !editable) return null;
            // Every field but the link back to this record, skipping ones no line fills in (an unused title) and
            // links a formula already shows (an Item formula reading product.name stands in for Product).
            const filled = (id: string) =>
              lines.some((l) => l.data[id] !== undefined && l.data[id] !== null && l.data[id] !== "");
            const mirrored = (id: string) =>
              child.fields.some((o) => filled(o.id) && !!o.formula?.expr.trim().startsWith(`${id}.`));
            const shown = child.fields
              .filter(
                (f) => f.id !== parentField && filled(f.id) && !(f.type === "relation" && mirrored(f.id)),
              )
              .sort((a, b) => Number(b.id === child.primaryFieldId) - Number(a.id === child.primaryFieldId))
              .slice(0, 4);
            return (
              <section key={child.id} className="mt-6">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-medium text-muted-foreground">{child.pluralName}</h3>
                  {lines.length > LINES_SHOWN ? (
                    <span className="text-[12px] text-muted-foreground tabular">
                      {lines.length.toLocaleString("en-PH")}
                    </span>
                  ) : null}
                  {editable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openCreate(child.id, { [parentField]: record.id }, { returnTo: record.id })
                      }
                    >
                      <PlusIcon data-icon="inline-start" />
                      Add {child.name.toLowerCase()}
                    </Button>
                  ) : null}
                </div>
                {lines.length ? (
                  <ul className="divide-y rounded-md border">
                    {lines.slice(0, linesShown[child.id] ?? LINES_SHOWN).map((line) => (
                      <li key={line.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        {shown.map((f, i) => (
                          <span key={f.id} className={i === 0 ? "min-w-0 flex-1 truncate" : "shrink-0"}>
                            <FieldValue field={f} value={line.data[f.id]} />
                          </span>
                        ))}
                      </li>
                    ))}
                    {lines.length > (linesShown[child.id] ?? LINES_SHOWN) ? (
                      <li>
                        <button
                          type="button"
                          onClick={() =>
                            setLinesShown((s) => ({
                              ...s,
                              [child.id]: (s[child.id] ?? LINES_SHOWN) + LINES_SHOWN * 4,
                            }))
                          }
                          className="w-full px-3 py-2 text-left text-[12.5px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
                        >
                          Show more (
                          {(lines.length - (linesShown[child.id] ?? LINES_SHOWN)).toLocaleString("en-PH")}{" "}
                          left)
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    No {child.pluralName.toLowerCase()} yet.
                  </p>
                )}
              </section>
            );
          })}

        {!editing ? (
          <>
            <Separator className="my-6" />
            <p className="text-[12px] text-muted-foreground">
              Created {formatDateTime(record.createdAt)}
              {record.updatedAt !== record.createdAt ? ` · Updated ${formatDateTime(record.updatedAt)}` : ""}
            </p>
          </>
        ) : null}
      </div>

      <SheetFooter className="flex-row gap-2 border-t px-5 py-3">
        {editing ? (
          <>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setEditing(false);
                setDraft(record.data);
                setErrors([]);
              }}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={save}>
              Save changes
            </Button>
          </>
        ) : (
          <>
            {status && next ? (
              <Button className="flex-1" onClick={() => actions.update(record.id, { [status.id]: next.id })}>
                Mark as {next.label.toLowerCase()}
              </Button>
            ) : null}
            {editableFields(entity).length ? (
              <Button variant="outline" className={next ? "" : "flex-1"} onClick={startEditing}>
                <PencilSimpleIcon data-icon="inline-start" />
                Edit
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label="More actions" />}
              >
                <DotsThreeIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {status?.options
                    ?.filter((o) => o.id !== current?.id && o.id !== next?.id)
                    .map((o) => (
                      <DropdownMenuItem
                        key={o.id}
                        onClick={() => actions.update(record.id, { [status.id]: o.id })}
                      >
                        Mark as {o.label.toLowerCase()}
                      </DropdownMenuItem>
                    ))}
                  {printables.map((t) => (
                    <DropdownMenuItem key={t.id} onClick={() => setPrinting(t)}>
                      <PrinterIcon />
                      Print {t.name.toLowerCase()}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      actions.remove(record.id, entity.name);
                      onClose();
                    }}
                  >
                    <TrashIcon />
                    Delete {entity.name.toLowerCase()}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </SheetFooter>
      {merging ? (
        <MergeDialog
          entity={entity}
          records={[record, merging]}
          onClose={() => setMerging(null)}
          onMerged={(keptId) => {
            setMerging(null);
            openRecord(keptId);
          }}
        />
      ) : null}
      {printing ? (
        <PrintDialog
          open
          title={`${printing.name} ${recordTitle(entity, record)}`}
          markdown={renderPrint(blueprint, printing, record, records)}
          paper={printing.paper}
          onClose={() => setPrinting(null)}
        />
      ) : null}
    </>
  );
}
