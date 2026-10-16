"use client";

import {
  CalendarCheckIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  LightningIcon,
  PlayIcon,
  PlusCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Rule } from "@/lib/blueprint/types";
import { describeActions, describeTrigger, isOn, isTimed } from "@/lib/engine/automations";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { SettingsPage, SettingsSection } from "./settings-section";

type Run = {
  id: number;
  ruleId: string;
  ruleName: string;
  recordLabel: string | null;
  trigger: "save" | "booking" | "schedule" | "date" | "manual";
  status: "done" | "pending" | "sent" | "failed" | "not_sent";
  detail: string | null;
  createdAt: string;
};

const TRIGGER: Record<Run["trigger"], string> = {
  save: "On save",
  booking: "Public booking",
  schedule: "Schedule",
  date: "Date",
  manual: "Run now",
};

const STATUS: Record<Run["status"], { label: string; tone: string }> = {
  done: { label: "Done", tone: "text-success" },
  sent: { label: "Emailed", tone: "text-success" },
  pending: { label: "Sending", tone: "text-muted-foreground" },
  failed: { label: "Failed", tone: "text-destructive" },
  not_sent: { label: "Not sent", tone: "text-warning" },
};

function TriggerIcon({ rule }: { rule: Rule }) {
  const Icon =
    rule.trigger.event === "schedule"
      ? ClockIcon
      : rule.trigger.event === "date_reached"
        ? CalendarCheckIcon
        : LightningIcon;
  return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function ActionIcon({ line }: { line: string }) {
  const Icon = line.startsWith("Email")
    ? EnvelopeSimpleIcon
    : line.startsWith("Add a")
      ? PlusCircleIcon
      : null;
  return Icon ? (
    <Icon className="size-3.5 shrink-0" />
  ) : (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      <span className="size-1 rounded-full bg-current" />
    </span>
  );
}

/** Settings → Automations: every automation in plain words, a switch for each, Run now and what they did. */
export function AutomationSettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role) && ws.mode === "live";
  const applyChange = useWorkspaces((s) => s.applyChange);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const rules = ws.blueprint.rules;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${ws.id}/automations`);
      const body = (await res.json()) as { ok: boolean; runs?: Run[] };
      setRuns(body.ok ? (body.runs ?? []) : []);
    } catch {
      setRuns([]);
    }
  }, [ws.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (rule: Rule, on: boolean) => {
    const entry = applyChange(ws.id, {
      request: `${on ? "Turn on" : "Turn off"} ${rule.name}`,
      title: `${on ? "Turned on" : "Turned off"} ${rule.name}`,
      facts: [],
      steps: [{ kind: "change", label: rule.name, detail: on ? "Runs again" : "Paused" }],
      ops: [{ op: "add_rule", rule: { ...rule, enabled: on } }],
    });
    if (entry)
      toast.success(`${rule.name} is ${on ? "on" : "off"}`, { description: "Undo it from History." });
  };

  const runNow = async (rule: Rule) => {
    setRunning(rule.id);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}/automations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const body = (await res.json()) as { ok: boolean; runs?: number; message?: string };
      if (!body.ok) throw new Error(body.message);
      toast.success(
        body.runs
          ? `${rule.name} ran for ${body.runs} record${body.runs === 1 ? "" : "s"}`
          : `${rule.name} had nothing to do today`,
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Couldn't run it");
    } finally {
      setRunning(null);
    }
  };

  const last = (rule: Rule) => runs?.find((r) => r.ruleId === rule.id);

  return (
    <SettingsPage>
      <SettingsSection
        title="Automations"
        description="What happens by itself when records are saved, at set times, or as dates come up. Ask EveryOps to add or change one; turn one off here to pause it."
        footer={
          rules.length
            ? `${rules.filter(isOn).length} of ${rules.length} on. Timed automations run every 15 minutes, Manila time.`
            : undefined
        }
      >
        {rules.length ? (
          <ul className="-mx-5 -mb-5 divide-y divide-foreground/[0.06] border-t border-foreground/[0.06]">
            {rules.map((rule) => {
              const on = isOn(rule);
              const recent = last(rule);
              return (
                <li
                  key={rule.id}
                  className={cn(
                    "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start",
                    !on && "opacity-60",
                  )}
                >
                  <div className="flex min-w-0 flex-1 gap-3">
                    <TriggerIcon rule={rule} />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[13.5px] font-medium">{rule.name}</span>
                      <span className="text-[12.5px] text-muted-foreground">
                        {describeTrigger(ws.blueprint, rule)}
                        {rule.when ? (
                          <span className="font-mono text-[11.5px]"> · if {rule.when}</span>
                        ) : null}
                      </span>
                      <ul className="flex flex-col gap-1">
                        {describeActions(ws.blueprint, rule).map((line, i) => (
                          <li
                            // biome-ignore lint/suspicious/noArrayIndexKey: actions have no ids and never reorder here
                            key={i}
                            className="flex items-center gap-2 text-[12.5px] text-foreground/85"
                          >
                            <ActionIcon line={line} />
                            <span className="truncate">{line}</span>
                          </li>
                        ))}
                      </ul>
                      {recent ? (
                        <span className="text-[12px] text-muted-foreground">
                          Last ran {formatDateTime(recent.createdAt)} ·{" "}
                          <span className={STATUS[recent.status].tone}>{STATUS[recent.status].label}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 pl-7 sm:pl-0">
                    {manager && isTimed(rule) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!on || running === rule.id}
                        onClick={() => void runNow(rule)}
                      >
                        <PlayIcon data-icon="inline-start" />
                        {running === rule.id ? "Running…" : "Run now"}
                      </Button>
                    ) : null}
                    <Switch
                      checked={on}
                      disabled={!manager}
                      onCheckedChange={(next) => toggle(rule, next)}
                      aria-label={`${rule.name} ${on ? "on" : "off"}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No automations yet. Ask EveryOps, for example: "Email each customer the day before their booking".
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Recent runs"
        description="What each automation did, on which record, and whether its emails went out."
      >
        {runs === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : runs.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead className="text-left text-muted-foreground">
                <tr className="border-y border-foreground/[0.06]">
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-2 py-2 font-medium">Automation</th>
                  <th className="px-2 py-2 font-medium">Record</th>
                  <th className="px-2 py-2 font-medium">Trigger</th>
                  <th className="px-5 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/[0.06]">
                {runs.map((run) => (
                  <tr key={run.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-2 py-2.5">{run.ruleName}</td>
                    <td className="px-2 py-2.5">{run.recordLabel ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                      {TRIGGER[run.trigger]}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={cn("font-medium", STATUS[run.status].tone)}>
                        {STATUS[run.status].label}
                      </span>
                      {run.detail ? <span className="block text-muted-foreground">{run.detail}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nothing has run yet.</p>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
