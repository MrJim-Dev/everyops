"use client";

import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { FieldValue } from "@/components/records/field-value";
import { PersonAvatar } from "@/components/records/person-chip";
import { useRecordPanels } from "@/components/records/record-panels";
import { StatusBadge } from "@/components/records/status-badge";
import { Button } from "@/components/ui/button";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { displayKind, isNumericKind } from "@/lib/blueprint/field-kind";
import { getEntity, getField, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { ApprovalQueueView as ApprovalConfig } from "@/lib/blueprint/types";
import { sortRecords } from "@/lib/engine/query";
import { ViewEmpty } from "./view-empty";
import { ToolbarSummary, ViewToolbar } from "./view-toolbar";

/** "1 day", "3 days": a number followed by its field name as the unit. */
function quantity(value: number, unit: string) {
  const word = unit.toLowerCase();
  return `${value} ${value === 1 && word.endsWith("s") ? word.slice(0, -1) : word}`;
}

export function ApprovalQueueView({ view }: { view: ApprovalConfig }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const actions = useRecordActions();
  const entity = getEntity(blueprint, view.entityId);
  const status = getField(entity, view.statusFieldId);
  const details = view.detailFieldIds.map((id) => getField(entity, id));

  const own = useMemo(() => records.filter((r) => r.entityId === entity.id), [records, entity.id]);
  const pending = useMemo(
    () =>
      sortRecords(
        own.filter((r) => r.data[status.id] === view.pending),
        [{ fieldId: details[1]?.id ?? entity.primaryFieldId, dir: "asc" }],
      ),
    [own, status.id, view.pending, details, entity.primaryFieldId],
  );
  const decided = useMemo(
    () =>
      [...own.filter((r) => r.data[status.id] !== view.pending)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5),
    [own, status.id, view.pending],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ViewToolbar>
        <span className="text-[13px] font-medium">Waiting for you</span>
        <ToolbarSummary>{pending.length} pending</ToolbarSummary>
      </ViewToolbar>
      {pending.length === 0 ? (
        <ViewEmpty
          title="You're all caught up"
          description={`New ${entity.pluralName.toLowerCase()} will appear here for review.`}
        />
      ) : (
        <ul className="divide-y">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <button
                type="button"
                onClick={() => openRecord(r.id)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <PersonAvatar name={recordTitle(entity, r)} className="size-8" />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium">{recordTitle(entity, r)}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
                    {details.map((field, i) => (
                      <span key={field.id} className="inline-flex items-center gap-2">
                        {i > 0 ? <span aria-hidden="true">·</span> : null}
                        {isNumericKind(displayKind(blueprint, field)) ? (
                          <span className="tabular">
                            {quantity(Number(r.data[field.id] ?? 0), field.name)}
                          </span>
                        ) : (
                          <FieldValue field={field} value={r.data[field.id]} />
                        )}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`${view.rejectLabel} ${recordTitle(entity, r)}`}
                  onClick={() => actions.update(r.id, { [status.id]: view.reject })}
                >
                  <XIcon data-icon="inline-start" />
                  {view.rejectLabel}
                </Button>
                <Button
                  size="sm"
                  aria-label={`${view.approveLabel} ${recordTitle(entity, r)}`}
                  onClick={() => actions.update(r.id, { [status.id]: view.approve })}
                >
                  <CheckIcon data-icon="inline-start" />
                  {view.approveLabel}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.length ? (
        <section className="mt-6 border-t">
          <h2 className="px-5 pb-1 pt-4 text-[12px] font-medium text-muted-foreground">Recently decided</h2>
          <ul>
            {decided.map((r) => {
              const option = optionOf(status, r.data[status.id]);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openRecord(r.id)}
                    className="flex h-10 w-full items-center gap-3 px-5 text-left text-[13px] outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate">{recordTitle(entity, r)}</span>
                    <span className="hidden text-muted-foreground sm:inline">
                      <FieldValue
                        field={details[1] ?? details[0]}
                        value={r.data[(details[1] ?? details[0]).id]}
                      />
                    </span>
                    {option ? <StatusBadge label={option.label} tone={option.tone} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
