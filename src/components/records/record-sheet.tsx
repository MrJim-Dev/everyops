"use client";

import { DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
import { editableFields, statusField } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, RecordData } from "@/lib/blueprint/types";
import type { FieldError } from "@/lib/engine/records";
import { formatDateTime } from "@/lib/format";
import { canEdit } from "@/lib/store/workspaces";
import { FieldValue } from "./field-value";
import { RecordFieldsForm } from "./record-fields-form";
import { useRecordPanels } from "./record-panels";
import { StatusMenu } from "./status-menu";

/** Side panel for one record: properties, its line items, and the next sensible action. */
export function RecordSheet({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const { records, blueprint } = useWorkspace();
  const record = recordId ? findRecord(records, recordId) : undefined;
  const entity = record ? findEntity(blueprint, record.entityId) : undefined;

  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[400px]">
        {record && entity ? (
          <RecordSheetBody key={record.id} record={record} entity={entity} onClose={onClose} />
        ) : null}
      </SheetContent>
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
  const { blueprint, records, role } = useWorkspace();
  const { openCreate } = useRecordPanels();
  const editable = canEdit(role);
  const actions = useRecordActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RecordData>(record.data);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const status = statusField(entity);
  const current = status ? optionOf(status, record.data[status.id]) : undefined;
  // The next sensible step is the first "success" option the record isn't in yet (e.g. Paid, Approved).
  const next = status?.options?.find((o) => o.tone === "success" && o.id !== current?.id);
  const children = blueprint.entities.filter((e) => e.parent?.entityId === entity.id);

  const save = () => {
    const result = actions.update(record.id, draft);
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
        {editing ? (
          <RecordFieldsForm
            entity={entity}
            values={draft}
            errors={errors}
            idPrefix={`edit-${record.id}`}
            onChange={(fieldId, value) => setDraft((d) => ({ ...d, [fieldId]: value }))}
          />
        ) : (
          <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-3 text-[13px]">
            {entity.fields
              .filter((f) => f.id !== entity.primaryFieldId && f.id !== status?.id)
              .map((field) => (
                <div key={field.id} className="contents">
                  <dt className="text-muted-foreground">{field.name}</dt>
                  <dd className="min-w-0">
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
                    {lines.map((line) => (
                      <li key={line.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        {shown.map((f, i) => (
                          <span key={f.id} className={i === 0 ? "min-w-0 flex-1 truncate" : "shrink-0"}>
                            <FieldValue field={f} value={line.data[f.id]} />
                          </span>
                        ))}
                      </li>
                    ))}
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
              <Button variant="outline" className={next ? "" : "flex-1"} onClick={() => setEditing(true)}>
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
    </>
  );
}
