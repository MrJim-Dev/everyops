"use client";

import { useEffect, useState } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AI_PERIODS,
  type AiPeriod,
  featureLabel,
  formatCost,
  formatTokens,
  originLabel,
  outcomeLabel,
  stepLabel,
  type UsageCall,
  type UsageGroup,
  type UsageReport,
} from "@/lib/ai-usage";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "1 request", "12 requests". */
const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? "" : "s"}`;

type Tab = { id: string; label: string; column: string; groups: UsageGroup[] };

/**
 * Where AI use came from: every Gemini call in the period, as totals, a day-by-day chart, breakdowns (feature, step,
 * model, where it ran, and person or workspace) and the latest calls. Costs are estimates at Vertex AI's rates.
 */
export function AiUsageReport({ endpoint, view }: { endpoint: string; view: "workspace" | "account" }) {
  const [period, setPeriod] = useState<AiPeriod>("month");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setReport(null);
    setFailed(false);
    fetch(`${endpoint}?period=${period}`)
      .then((r) => r.json())
      .then((body: { ok: boolean; report?: UsageReport }) => {
        if (!live) return;
        if (body.ok && body.report) setReport(body.report);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [endpoint, period]);

  const tabs: Tab[] = report
    ? [
        ...(report.byWorkspace
          ? [{ id: "workspace", label: "Workspace", column: "Workspace", groups: report.byWorkspace }]
          : []),
        { id: "feature", label: "Feature", column: "Feature", groups: report.byFeature },
        { id: "step", label: "Step", column: "Step", groups: report.byStep },
        ...(report.byPerson
          ? [{ id: "person", label: "Person", column: "Person", groups: report.byPerson }]
          : []),
        { id: "model", label: "Model", column: "Model", groups: report.byModel },
        { id: "origin", label: "Where it ran", column: "Where it ran", groups: report.byOrigin },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          htmlFor={`ai-period-${view}`}
          className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
        >
          Period
          <NativeSelect
            id={`ai-period-${view}`}
            size="sm"
            value={period}
            onChange={(e) => setPeriod(e.target.value as AiPeriod)}
          >
            {Object.entries(AI_PERIODS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {report ? (
          <span className="text-[12px] text-muted-foreground">
            {formatDate(report.from)} – {formatDate(report.to, { withYear: true })}
          </span>
        ) : null}
      </div>

      {failed ? (
        <p className="text-[13px] text-muted-foreground">AI use couldn't be loaded. Try again in a moment.</p>
      ) : !report ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : report.totals.calls === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          No AI use in this period yet.
        </p>
      ) : (
        <>
          <Totals report={report} />
          <DailyChart daily={report.daily} />
          <Tabs defaultValue={tabs[0]?.id}>
            <TabsList className="max-w-full overflow-x-auto">
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((t) => (
              <TabsContent key={t.id} value={t.id} className="pt-2">
                <Breakdown column={t.column} groups={t.groups} total={report.totals.costMicros} />
              </TabsContent>
            ))}
          </Tabs>
          <Recent calls={report.recent} view={view} />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "warning";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-foreground/[0.06] bg-background/40 px-3.5 py-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-[20px] tabular-nums", tone === "warning" && "text-warning")}>
        {value}
      </span>
      {note ? <span className="text-[11.5px] leading-snug text-muted-foreground">{note}</span> : null}
    </div>
  );
}

function Totals({ report }: { report: UsageReport }) {
  const t = report.totals;
  const wastedShare = t.costMicros ? t.wastedMicros / t.costMicros : 0;
  const perRequest = t.requests ? t.calls / t.requests : 0;
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <Stat label="Estimated cost" value={formatCost(t.costMicros)} note="At Vertex AI list rates" />
      <Stat
        label="Tokens"
        value={formatTokens(t.input + t.output + t.thinking)}
        note={`${formatTokens(t.input)} in (${formatTokens(t.cached)} cached) · ${formatTokens(t.output + t.thinking)} out`}
      />
      <Stat
        label="Gemini calls"
        value={formatNumber(t.calls)}
        note={`${plural(t.requests, "request")} · ${perRequest.toFixed(1)} calls each`}
      />
      <Stat
        label="Wasted"
        value={formatCost(t.wastedMicros)}
        tone={wastedShare >= 0.1 ? "warning" : undefined}
        note={`${Math.round(wastedShare * 100)}% · ${plural(t.wastedCalls, "duplicate or failed call")}`}
      />
    </div>
  );
}

function DailyChart({ daily }: { daily: UsageReport["daily"] }) {
  const max = Math.max(...daily.map((d) => d.costMicros), 1);
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-[12px] text-muted-foreground">Estimated cost per day</figcaption>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label="Estimated AI cost per day">
        {daily.map((d) => (
          <div
            key={d.day}
            title={`${formatDate(d.day)}: ${formatCost(d.costMicros)} · ${formatTokens(d.tokens)} tokens · ${d.calls} calls`}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <div
              className={cn(
                "w-full rounded-[2px] transition-colors",
                d.costMicros ? "bg-foreground/55 group-hover:bg-foreground" : "bg-foreground/[0.07]",
              )}
              style={{ height: d.costMicros ? `${Math.max(4, (d.costMicros / max) * 100)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{formatDate(daily[0]?.day ?? "")}</span>
        <span>Highest {formatCost(max)}</span>
        <span>{formatDate(daily.at(-1)?.day ?? "")}</span>
      </div>
    </figure>
  );
}

function Breakdown({ column, groups, total }: { column: string; groups: UsageGroup[]; total: number }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40%]">{column}</TableHead>
          <TableHead className="text-right">Calls</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Wasted</TableHead>
          <TableHead className="text-right">Est. cost</TableHead>
          <TableHead className="w-[18%]">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((g) => {
          const share = total ? g.costMicros / total : 0;
          return (
            <TableRow key={g.key || g.label}>
              <TableCell className="max-w-[260px]">
                <div className="truncate font-medium">{g.label}</div>
                {g.detail ? (
                  <div className="truncate text-[12px] text-muted-foreground">{g.detail}</div>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(g.calls)}
                {g.requests && g.requests !== g.calls ? (
                  <div className="text-[11.5px] text-muted-foreground">{plural(g.requests, "request")}</div>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatTokens(g.tokens)}</TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  g.wastedMicros ? "text-warning" : "text-muted-foreground",
                )}
              >
                {g.wastedMicros ? formatCost(g.wastedMicros) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{formatCost(g.costMicros)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                    <div
                      className="h-full rounded-full bg-foreground/60"
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                  <span className="w-9 text-right text-[11.5px] text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Recent({ calls, view }: { calls: UsageCall[]; view: "workspace" | "account" }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-medium">Latest calls</h3>
      <Table className="text-[12.5px]">
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Est. cost</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Where it ran</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((c, i) => (
            <TableRow key={`${c.at}-${i}`}>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {formatDateTime(c.at)}
              </TableCell>
              <TableCell className="max-w-[240px]">
                <div className="truncate">
                  {featureLabel(c.feature)} · {stepLabel(c.task)}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {view === "account" ? (c.workspace ?? "Setup and account") : (c.person ?? "")}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {c.model}
                <div className="text-[11.5px] text-muted-foreground">{c.location}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.estimated ? "≈" : ""}
                {formatTokens(c.tokens)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{formatCost(c.costMicros)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-full border px-2 text-[11.5px]",
                    c.outcome === "ok"
                      ? "border-foreground/10 text-muted-foreground"
                      : c.outcome === "cancelled"
                        ? "border-warning/40 text-warning"
                        : "border-destructive/30 text-destructive",
                  )}
                >
                  {outcomeLabel(c.outcome)}
                </span>
                <div className="text-[11.5px] text-muted-foreground">
                  {(c.ms / 1000).toFixed(1)} s{c.attempt ? ` · attempt ${c.attempt + 1}` : ""}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {originLabel(c.origin)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
