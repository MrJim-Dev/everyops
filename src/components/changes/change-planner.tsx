"use client";

import { ArrowRightIcon, MinusIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { type AiPlanResult, requestPlan } from "@/lib/assistant/ai-client";
import { EXAMPLE_REQUESTS } from "@/lib/assistant/planner";
import { displayKind } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, recordTitle } from "@/lib/blueprint/lookup";
import { applyOps, computeImpact } from "@/lib/engine/changes";
import { formatMoney } from "@/lib/format";
import { markFresh } from "@/lib/motion/fresh";
import { useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = 3;

/**
 * Ask for a change → review a plan in plain words → apply with undo.
 * Nothing changes until the owner presses Apply.
 */
export function ChangePlanner({ onDone, autoFocus }: { onDone?: () => void; autoFocus?: boolean }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const [request, setRequest] = useState("");
  const [result, setResult] = useState<AiPlanResult | null>(null);
  const [pending, setPending] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const review = async () => {
    if (!request.trim() || pending) return;
    setPending(true);
    const next = await requestPlan(ws.blueprint, request.trim());
    setPending(false);
    setResult(next);
  };
  const plan = result?.ok ? result.plan : null;

  const impact = useMemo(() => {
    if (!plan) return null;
    return computeImpact(ws.data, applyOps(ws.blueprint, plan.ops));
  }, [plan, ws.data, ws.blueprint]);

  // One money row per changed record: its total if it has one, otherwise the first money field.
  const rows = useMemo(() => {
    if (!impact) return [];
    const byRecord = new Map<string, (typeof impact.changes)[number][]>();
    for (const c of impact.changes) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
    // Prefer records whose own formulas changed (bookings), not totals that follow from them.
    const focus = new Set(
      (plan?.ops ?? []).flatMap((op) => (op.op === "update_field" && op.patch.formula ? [op.entityId] : [])),
    );
    return [...byRecord].flatMap(([recordId, changes]) => {
      const record = findRecord(ws.records, recordId);
      const entity = record ? findEntity(ws.blueprint, record.entityId) : undefined;
      if (!record || !entity || (focus.size && !focus.has(entity.id))) return [];
      const money = changes.filter((c) => {
        const field = entity.fields.find((f) => f.id === c.fieldId);
        return field && displayKind(ws.blueprint, field) === "money";
      });
      const pick = money.find((c) => c.fieldId === "amount") ?? money[0];
      if (!pick) return [];
      return [
        { id: recordId, entity, record, before: Number(pick.before ?? 0), after: Number(pick.after ?? 0) },
      ];
    });
  }, [impact, plan, ws.records, ws.blueprint]);

  const changedEntities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of impact?.changedRecordIds ?? []) {
      const record = findRecord(ws.records, id);
      if (record) counts.set(record.entityId, (counts.get(record.entityId) ?? 0) + 1);
    }
    return [...counts].map(([entityId, count]) => ({ entity: findEntity(ws.blueprint, entityId), count }));
  }, [impact, ws.records, ws.blueprint]);

  const touchesFormulas = plan?.ops.some((op) => op.op === "update_field" && op.patch.formula) ?? false;
  const frozen = touchesFormulas
    ? (impact?.frozenRecordIds.filter((id) => !impact.changedRecordIds.includes(id)).length ?? 0)
    : 0;

  const apply = () => {
    if (!plan) return;
    const entry = applyChange(ws.id, plan);
    if (!entry) return;
    const touched = [...new Set(entry.recordChanges.map((c) => c.recordId))];
    markFresh(touched);
    toast.success(`${plan.title} applied`, {
      description: `Version ${entry.toVersion} is live.`,
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: () => {
          undoChange(ws.id, entry.id);
          markFresh(touched);
        },
      },
    });
    setRequest("");
    setResult(null);
    onDone?.();
  };

  if (!plan) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void review();
        }}
      >
        <Textarea
          autoFocus={autoFocus}
          value={request}
          readOnly={pending}
          onChange={(e) => {
            setRequest(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void review();
            }
          }}
          rows={3}
          placeholder="Describe what you want to change…"
          aria-label="Describe the change"
          className="resize-none text-[14px]"
        />
        {result && !result.ok ? (
          <p role="alert" className="text-[13px] text-warning">
            {result.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_REQUESTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setRequest(example);
                setResult(null);
              }}
              className="rounded-full border px-3 py-1 text-[12px] text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {example}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3">
          <span className="hidden text-[12px] text-muted-foreground sm:inline">
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to review
          </span>
          <Button type="submit" disabled={!request.trim() || pending}>
            {pending ? "Planning with Gemini…" : "Review change"}
          </Button>
        </div>
      </form>
    );
  }

  const shown = showAll ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <div className="flex flex-col gap-5">
      <h3 className="animate-rise text-[15px] font-semibold">
        Review {plan.title.charAt(0).toLowerCase() + plan.title.slice(1)}
      </h3>
      <p className="-mt-3 text-[12px] text-muted-foreground">
        {result?.source === "gemini"
          ? "Planned by Gemini and checked against your workspace. Nothing changes until you apply it."
          : "Planned by the built-in planner because Gemini wasn't reachable. Nothing changes until you apply it."}
      </p>
      <blockquote
        className="animate-rise stagger rounded-lg border bg-muted/40 px-4 py-3 text-[14px]"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        “{plan.request}”
      </blockquote>

      {plan.facts.length ? (
        <dl
          className="animate-rise stagger grid grid-cols-2 overflow-hidden rounded-lg border"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          {plan.facts.map((fact, i) => (
            <div
              key={fact.label}
              className={cn(
                "flex flex-col gap-0.5 px-4 py-3",
                i % 2 === 1 && "border-l",
                i > 1 && "border-t",
              )}
            >
              <dt className="text-[12px] text-muted-foreground">{fact.label}</dt>
              <dd className="text-[15px] font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section
        className="animate-rise stagger flex flex-col gap-2"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <h3 className="text-[13px] font-semibold">What will change</h3>
        <ul className="divide-y rounded-lg border">
          {plan.steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
                  step.kind === "add" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning",
                )}
              >
                {step.kind === "add" ? (
                  <PlusIcon className="size-3" />
                ) : (
                  <PencilSimpleIcon className="size-3" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  <span className="sr-only">{step.kind === "add" ? "Added: " : "Changed: "}</span>
                  {step.label}
                </span>
                <span className="text-[12.5px] text-muted-foreground tabular">{step.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {impact ? (
        <section
          className="animate-rise stagger flex flex-col gap-2"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          <h3 className="text-[13px] font-semibold">Impact on existing records</h3>
          {impact.errors.length ? (
            <ul className="rounded-lg border border-destructive/40 px-4 py-3 text-[13px] text-destructive">
              {impact.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {changedEntities.length === 0 ? (
                <li className="text-muted-foreground">No existing records change.</li>
              ) : null}
              {changedEntities.map(({ entity, count }) => (
                <li key={entity?.id} className="flex items-center gap-2">
                  <ArrowRightIcon className="size-3.5 text-primary" />
                  {count} {count === 1 ? entity?.name.toLowerCase() : entity?.pluralName.toLowerCase()} will
                  be updated
                </li>
              ))}
              {frozen ? (
                <li className="flex items-center gap-2 text-muted-foreground">
                  <MinusIcon className="size-3.5" />
                  {frozen} paid or past records keep their original values
                </li>
              ) : null}
            </ul>
          )}
          {rows.length ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-[12.5px]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-normal">Record</th>
                    <th className="px-4 py-2 text-right font-normal">Current</th>
                    <th className="px-4 py-2 text-right font-normal">New</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((row) => (
                    <tr key={row.id}>
                      <td className="max-w-0 truncate px-4 py-2">{recordTitle(row.entity, row.record)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground tabular">
                        {formatMoney(row.before)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular">{formatMoney(row.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > PREVIEW_ROWS ? (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="w-full border-t px-4 py-2 text-left text-[12.5px] text-primary outline-none hover:bg-muted/40 focus-visible:bg-muted"
                >
                  {showAll ? "Show fewer" : `View all ${rows.length}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <p className="w-full text-[12.5px] text-muted-foreground">
          Nothing changes until you apply. You can undo it from History.
        </p>
        <Button variant="outline" onClick={() => setResult(null)}>
          Edit request
        </Button>
        <Button onClick={apply} disabled={!!impact?.errors.length}>
          Apply changes
        </Button>
      </div>
    </div>
  );
}
