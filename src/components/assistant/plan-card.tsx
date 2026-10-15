"use client";

import {
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  CheckIcon,
  MinusCircleIcon,
  MinusIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { AssistantTurn } from "@/lib/assistant/panel-store";
import { displayKind } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, recordTitle } from "@/lib/blueprint/lookup";
import type { Block } from "@/lib/blueprint/types";
import { applyOps, type ChangePlan, computeImpact, patchFor } from "@/lib/engine/changes";
import { formatMoney } from "@/lib/format";
import { docKey } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = 3;

const WORD_LABELS: Record<string, string> = {
  heading: "Headline",
  subheading: "Intro",
  ctaLabel: "Button",
  title: "Heading",
  markdown: "Text",
  phone: "Phone",
  email: "Email",
  address: "Address",
  hours: "Hours",
};

/** The words a website edit changes, now and after, so the owner reads the actual new copy before applying. */
function useWordChanges(plan: ChangePlan) {
  const ws = useWorkspace();
  return useMemo(() => {
    const rows: { key: string; label: string; before?: string; after: string }[] = [];
    for (const op of plan.ops) {
      if (op.op === "remove_block") {
        rows.push({ key: `${op.blockId}-remove`, label: "Section", before: op.blockId, after: "Removed" });
        continue;
      }
      if (op.op !== "update_block") continue;
      const view = ws.blueprint.views.find((v) => v.id === op.viewId);
      const block: Block | undefined =
        view && (view.type === "landing" || view.type === "form")
          ? view.blocks?.find((b) => b.id === op.blockId)
          : undefined;
      if (!block) continue;
      let edited: Record<string, string> = {};
      const override = ws.docs[docKey(op.viewId, op.blockId)]?.body;
      if (override)
        try {
          edited = block.type === "hero" ? JSON.parse(override) : { markdown: override };
        } catch {}
      for (const [k, v] of Object.entries(patchFor(block, op.patch))) {
        if (k === "items" && Array.isArray(v)) {
          for (const [i, item] of v.entries())
            rows.push({
              key: `${op.blockId}-item-${i}`,
              label: `Item ${i + 1}`,
              after: `${item.title}: ${item.body}`,
            });
          continue;
        }
        const before = edited[k] || ((block as Record<string, unknown>)[k] as string | undefined);
        // Words Gemini repeated unchanged aren't a change.
        if (before !== String(v))
          rows.push({ key: `${op.blockId}-${k}`, label: WORD_LABELS[k] ?? k, before, after: String(v) });
      }
    }
    return rows;
  }, [plan.ops, ws.blueprint, ws.docs]);
}

/** What a design plan does to records that already exist: counts, and money before and after. */
function useImpact(plan: ChangePlan, active: boolean) {
  const ws = useWorkspace();
  return useMemo(() => {
    if (!active || !plan.ops.length) return null;
    let impact: ReturnType<typeof computeImpact>;
    try {
      impact = computeImpact(ws.data, applyOps(ws.blueprint, plan.ops));
    } catch {
      return null;
    }
    const counts = new Map<string, number>();
    for (const id of impact.changedRecordIds) {
      const record = findRecord(ws.records, id);
      if (record) counts.set(record.entityId, (counts.get(record.entityId) ?? 0) + 1);
    }
    const entities = [...counts].map(([entityId, count]) => ({
      entity: findEntity(ws.blueprint, entityId),
      count,
    }));
    // One money row per changed record, preferring records whose own formulas changed.
    const focus = new Set(
      plan.ops.flatMap((op) => (op.op === "update_field" && op.patch.formula ? [op.entityId] : [])),
    );
    const byRecord = new Map<string, (typeof impact.changes)[number][]>();
    for (const c of impact.changes) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
    const rows = [...byRecord].flatMap(([recordId, changes]) => {
      const record = findRecord(ws.records, recordId);
      const entity = record ? findEntity(ws.blueprint, record.entityId) : undefined;
      if (!record || !entity || (focus.size && !focus.has(entity.id))) return [];
      const money = changes.filter((c) => {
        const field = entity.fields.find((f) => f.id === c.fieldId);
        return field && displayKind(ws.blueprint, field) === "money";
      });
      const pick = money.find((c) => c.fieldId === "amount") ?? money[0];
      return pick
        ? [
            {
              id: recordId,
              title: recordTitle(entity, record),
              before: Number(pick.before ?? 0),
              after: Number(pick.after ?? 0),
            },
          ]
        : [];
    });
    const frozen = focus.size
      ? impact.frozenRecordIds.filter((id) => !impact.changedRecordIds.includes(id)).length
      : 0;
    return { errors: impact.errors, entities, rows, frozen };
  }, [active, plan.ops, ws.data, ws.blueprint, ws.records]);
}

/**
 * A change the assistant proposes. Nothing happens until Apply; applied plans can be undone here.
 * Sections rise in one after another so the parts of the plan read in order.
 */
export function PlanCard({
  plan,
  state,
  auto,
  onApply,
  onDismiss,
  onUndo,
  onOpenPage,
}: {
  plan: ChangePlan;
  state: AssistantTurn["planState"];
  /** Applied on its own, as the workspace's permissions allow. */
  auto?: boolean;
  onApply: () => void;
  onDismiss: () => void;
  onUndo: () => void;
  onOpenPage?: () => void;
}) {
  const waiting = !state || state === "pending";
  const impact = useImpact(plan, waiting);
  const words = useWordChanges(plan);
  const [showAll, setShowAll] = useState(false);
  const created = plan.recordOps?.filter((o) => o.op === "create_record").length ?? 0;
  const updated = plan.recordOps?.filter((o) => o.op === "update_record").length ?? 0;
  const deleted = plan.recordOps?.filter((o) => o.op === "delete_record").length ?? 0;
  const removes =
    deleted > 0 ||
    plan.ops.some((o) => o.op.startsWith("remove_")) ||
    plan.steps.some((s) => s.kind === "remove");
  const shown = showAll ? (impact?.rows ?? []) : (impact?.rows ?? []).slice(0, PREVIEW_ROWS);

  return (
    <div
      className={cn(
        "stagger-children mt-3 overflow-hidden rounded-xl border bg-card text-[13px] transition-colors duration-200",
        state === "applied" && "border-primary/35",
      )}
    >
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/12 text-primary">
          <NotePencilIcon className="size-3.5" />
        </span>
        <span className="flex-1 font-medium">{plan.title}</span>
        <span className="text-[11.5px] text-muted-foreground">
          {state === "applied"
            ? auto
              ? "Auto-applied"
              : "Applied"
            : state === "undone"
              ? "Undone"
              : state === "dismissed"
                ? "Not applied"
                : "Proposed change"}
        </span>
      </div>

      {plan.facts.length ? (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] border-b">
          {plan.facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-0.5 px-3.5 py-2.5">
              <dt className="text-[11.5px] text-muted-foreground">{f.label}</dt>
              <dd
                className={cn(
                  "text-[14px] font-medium tabular",
                  f.label === "Records deleted" && "text-destructive",
                )}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <ul className="flex flex-col gap-2.5 px-3.5 py-3">
        {plan.steps.map((s) => (
          <li key={`${s.label}-${s.detail}`} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
                s.kind === "add"
                  ? "bg-primary/15 text-primary"
                  : s.kind === "remove"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/15 text-warning",
              )}
            >
              {s.kind === "add" ? (
                <PlusIcon className="size-3" />
              ) : s.kind === "remove" ? (
                <MinusCircleIcon className="size-3" />
              ) : (
                <PencilSimpleIcon className="size-3" />
              )}
            </span>
            <span className="min-w-0">
              <span className="sr-only">
                {s.kind === "add" ? "Added: " : s.kind === "remove" ? "Removed: " : "Changed: "}
              </span>
              <span className="font-medium">{s.label}</span>
              {s.detail ? (
                <span className="block text-[12.5px] text-muted-foreground tabular">{s.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {waiting && words.length ? (
        <dl className="flex flex-col gap-2.5 border-t px-3.5 py-3">
          {words.map((w) => (
            <div key={w.key} className="flex flex-col gap-0.5">
              <dt className="text-[11.5px] text-muted-foreground">{w.label}</dt>
              {w.before && w.before !== w.after ? (
                <dd className="text-[12.5px] text-muted-foreground/70 line-through decoration-muted-foreground/40 [overflow-wrap:anywhere]">
                  {w.before}
                </dd>
              ) : null}
              <dd className="text-[13px] font-medium [overflow-wrap:anywhere]">{w.after}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {waiting && (impact || created || updated || deleted) ? (
        <div className="flex flex-col gap-2 border-t px-3.5 py-3 text-[12.5px]">
          {impact?.errors.length ? (
            <ul className="text-destructive">
              {impact.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-1">
              {impact?.entities.map(({ entity, count }) => (
                <li key={entity?.id} className="flex items-center gap-2">
                  <ArrowRightIcon className="size-3.5 text-primary" />
                  {count} {count === 1 ? entity?.name.toLowerCase() : entity?.pluralName.toLowerCase()} will
                  be updated
                </li>
              ))}
              {created ? (
                <li className="flex items-center gap-2">
                  <PlusIcon className="size-3.5 text-primary" />
                  Adds {created} {created === 1 ? "record" : "records"}
                </li>
              ) : null}
              {updated ? (
                <li className="flex items-center gap-2">
                  <PencilSimpleIcon className="size-3.5 text-primary" />
                  Updates {updated} {updated === 1 ? "record" : "records"}
                </li>
              ) : null}
              {deleted ? (
                <li className="flex items-center gap-2 text-destructive">
                  <MinusCircleIcon className="size-3.5" />
                  Deletes {deleted} {deleted === 1 ? "record" : "records"}
                </li>
              ) : null}
              {impact?.frozen ? (
                <li className="flex items-center gap-2 text-muted-foreground">
                  <MinusIcon className="size-3.5" />
                  {impact.frozen} paid or past records keep their original values
                </li>
              ) : null}
              {impact && !impact.entities.length && !created && !updated && !deleted ? (
                <li className="text-muted-foreground">No existing records change.</li>
              ) : null}
            </ul>
          )}
          {impact?.rows.length ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-normal">Record</th>
                    <th className="px-3 py-1.5 text-right font-normal">Now</th>
                    <th className="px-3 py-1.5 text-right font-normal">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((row) => (
                    <tr key={row.id}>
                      <td className="max-w-0 truncate px-3 py-1.5">{row.title}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground tabular">
                        {formatMoney(row.before)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular">{formatMoney(row.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {impact.rows.length > PREVIEW_ROWS ? (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="w-full cursor-pointer border-t px-3 py-1.5 text-left text-primary outline-none hover:bg-muted/40 focus-visible:bg-muted"
                >
                  {showAll ? "Show fewer" : `View all ${impact.rows.length}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t px-3.5 py-2.5">
        {state === "applied" ? (
          <>
            <span key="applied" className="flex flex-1 animate-pop items-center gap-1.5 text-primary">
              <CheckIcon className="size-3.5" />
              {auto ? "Applied automatically · saved to History" : "Applied and saved to History"}
            </span>
            {onOpenPage ? (
              <Button size="sm" variant="ghost" onClick={onOpenPage}>
                <ArrowRightIcon data-icon="inline-start" />
                Open
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onUndo}>
              <ArrowUUpLeftIcon data-icon="inline-start" />
              Undo
            </Button>
          </>
        ) : state === "undone" ? (
          <span className="text-muted-foreground">Undone</span>
        ) : state === "dismissed" ? (
          <span className="text-muted-foreground">Not applied</span>
        ) : (
          <>
            <Button
              size="sm"
              variant={removes ? "destructive" : "default"}
              onClick={onApply}
              disabled={!!impact?.errors.length}
            >
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
            <span className="ml-auto hidden text-[11.5px] text-muted-foreground sm:inline">
              {removes ? "You can undo it afterwards" : "Nothing changes until you apply"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
