"use client";

import { ChartLineUpIcon, WrenchIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { System } from "@/lib/blueprint/types";
import type { ChangeOp } from "@/lib/engine/changes";
import { suggestWidgets } from "@/lib/engine/dashboard-suggest";
import { repairRules } from "@/lib/engine/rule-repair";
import { canManage } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";

/**
 * Offers what a sparse dashboard is missing (charts and lists worked out from the records) and fixes automations
 * that can't run, as one undoable change the owner applies. Nothing changes until they press the button.
 */
export function DashboardSuggestions({ system }: { system: System }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  if (ws.mode !== "live" || !canManage(ws.role)) return null;
  const widgets = suggestWidgets(ws.blueprint, system);
  const repaired = repairRules(ws.blueprint);
  const broken = ws.blueprint.rules.filter((r) => {
    const fixed = repaired.find((x) => x.id === r.id);
    return !fixed || JSON.stringify(fixed) !== JSON.stringify(r);
  });
  const fixable = broken.filter((r) => repaired.some((x) => x.id === r.id));
  if (!widgets.length && !fixable.length) return null;

  const addCharts = () => {
    const entry = applyChange(ws.id, {
      request: `Fill ${system.name} with charts`,
      title: `Add charts to ${system.name}`,
      facts: [],
      steps: widgets.map((w) => ({
        kind: "add" as const,
        label: w.title,
        detail: w.type === "list" ? "List" : "Chart",
      })),
      ops: widgets.map((widget): ChangeOp => ({ op: "add_widget", systemId: system.id, widget })),
    });
    if (entry)
      toast.success(`Added ${widgets.length} cards to ${system.name}`, {
        description: "Undo it from History.",
      });
  };
  const fixRules = () => {
    const ops: ChangeOp[] = fixable.flatMap((r): ChangeOp[] => {
      const rule = repaired.find((x) => x.id === r.id);
      return rule
        ? [
            { op: "remove_rule", ruleId: r.id },
            { op: "add_rule", rule },
          ]
        : [];
    });
    const entry = applyChange(ws.id, {
      request: "Fix automations that don't change anything",
      title: "Fix automations",
      facts: [],
      steps: fixable.map((r) => ({
        kind: "change" as const,
        label: r.name,
        detail: "Now updates the field it names",
      })),
      ops,
    });
    if (entry)
      toast.success("Automations fixed", { description: "New sales and restocks now update stock." });
  };

  return (
    <div className="flex flex-col gap-2 border-b bg-muted/30 px-5 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        {widgets.length ? (
          <span className="truncate">
            <span className="font-medium">Make this page more useful:</span>{" "}
            <span className="text-muted-foreground">{widgets.map((w) => w.title).join(", ")}</span>
          </span>
        ) : null}
        {fixable.length ? (
          <span className="truncate text-warning">
            {fixable.map((r) => r.name).join(", ")} {fixable.length > 1 ? "don't" : "doesn't"} change anything
            yet.
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {fixable.length ? (
          <Button size="sm" variant="outline" onClick={fixRules}>
            <WrenchIcon data-icon="inline-start" />
            Fix automations
          </Button>
        ) : null}
        {widgets.length ? (
          <Button size="sm" onClick={addCharts}>
            <ChartLineUpIcon data-icon="inline-start" />
            Add {widgets.length} cards
          </Button>
        ) : null}
      </div>
    </div>
  );
}
