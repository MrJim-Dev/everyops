"use client";

import { MagnifyingGlassIcon, PauseCircleIcon, WarningIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Meter } from "@/components/billing/meter";
import { Badge } from "@/components/ui/badge";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost } from "@/lib/ai-usage";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/billing/plans";
import { type AccountRow, formatBytes, type SpendOverview } from "@/lib/billing/usage";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** /admin/accounts: plans, this month's use, the AI safety switch, and changing an account. */
export function AccountsTable({ accounts, spend }: { accounts: AccountRow[]; spend: SpendOverview }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AccountRow | null>(null);
  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get("email");
    if (email) setQuery(email);
  }, []);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? accounts.filter((a) => `${a.name} ${a.email} ${a.plan}`.toLowerCase().includes(q)) : accounts;
  }, [accounts, query]);
  const pending = accounts.filter((a) => a.pendingRequest).length;
  const paid = accounts.filter((a) => PLANS[a.plan].monthlyCentavos > 0).length;
  const todayShare = Math.min(100, (spend.todayMicros / (spend.limitUsd * 1_000_000)) * 100);

  return (
    <section className="mt-10 flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Accounts</h1>
          <p className="text-[13.5px] text-muted-foreground">
            {accounts.length} accounts · {paid} on a paid plan
            {pending ? ` · ${pending} asked to upgrade` : ""}. Assign plans here while online payment isn't
            connected.
          </p>
        </div>
        <Link href="/admin/waitlist" className="text-[13px] text-muted-foreground hover:text-foreground">
          Waitlist →
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="AI spending today" value={formatCost(spend.todayMicros)}>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
            <div
              className={cn(
                "h-full rounded-full",
                spend.on ? "bg-destructive" : todayShare >= 80 ? "bg-amber-400" : "bg-primary",
              )}
              style={{ width: `${Math.max(todayShare, 1)}%` }}
            />
          </div>
          <span className="mt-1.5 text-[12px] text-muted-foreground">
            Safety limit ${spend.limitUsd}/day ·{" "}
            {spend.on ? (
              <span className="text-destructive">free AI paused until midnight</span>
            ) : (
              "free AI on"
            )}
          </span>
        </Stat>
        <Stat label="AI spending this month" value={formatCost(spend.monthMicros)}>
          <span className="mt-1.5 text-[12px] text-muted-foreground">
            {formatCost(spend.wastedMonthMicros)} wasted on retries and failures
          </span>
        </Stat>
        <Stat label="Upgrade requests" value={String(pending)}>
          <span className="mt-1.5 text-[12px] text-muted-foreground">
            Arrange payment, then assign the plan.
          </span>
        </Stat>
      </div>

      <div className="relative max-w-[320px]">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find by name, email or plan"
          className="h-9 pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="w-[200px]">AI credits this month</TableHead>
              <TableHead className="text-right">Workspaces</TableHead>
              <TableHead className="text-right">Records</TableHead>
              <TableHead className="text-right">Files</TableHead>
              <TableHead>Last AI</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id} data-email={a.email}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{a.name || "—"}</span>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      {a.email}
                      {!a.verified ? (
                        <span title="Email not verified" className="text-amber-400">
                          <WarningIcon className="size-3.5" />
                        </span>
                      ) : null}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={PLANS[a.plan].monthlyCentavos ? "default" : "secondary"}>
                      {PLANS[a.plan].name}
                    </Badge>
                    {a.suspended ? (
                      <Badge variant="destructive" className="gap-1">
                        <PauseCircleIcon />
                        Suspended
                      </Badge>
                    ) : null}
                    {a.pendingRequest ? <Badge variant="outline">Wants {a.pendingRequest}</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Meter
                    label={`${a.aiRequests} request${a.aiRequests === 1 ? "" : "s"}`}
                    used={a.creditsUsed}
                    limit={a.allowance}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{a.workspaces}</TableCell>
                <TableCell className="text-right tabular-nums">{a.records.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(a.storageBytes)}</TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">
                  {a.lastAiAt ? formatDateTime(a.lastAiAt) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <ManageDialog
          account={editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-foreground/[0.08] bg-card/40 p-4">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[22px] tabular-nums">{value}</span>
      {children}
    </div>
  );
}

function ManageDialog({ account, onClose }: { account: AccountRow; onClose: (changed: boolean) => void }) {
  const [plan, setPlan] = useState<PlanId>(account.plan);
  const [grant, setGrant] = useState("");
  const [reason, setReason] = useState(account.suspendedReason ?? "");
  const [note, setNote] = useState(account.note ?? "");
  const [saving, setSaving] = useState(false);

  const send = async (change: Record<string, unknown>, done: string) => {
    setSaving(true);
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: account.id, ...change }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    setSaving(false);
    if (!body?.ok) return toast.error(body?.message ?? "Couldn't save. Try again.");
    toast.success(done);
    onClose(true);
  };

  const save = () => {
    const change: Record<string, unknown> = {};
    if (plan !== account.plan || account.source !== "assigned") change.plan = plan;
    const credits = Number(grant);
    if (grant && Number.isInteger(credits) && credits > 0) change.grantCredits = credits;
    if (note.trim() !== (account.note ?? "")) change.note = note.trim() || null;
    if (!Object.keys(change).length) return onClose(false);
    void send(change, `Saved ${account.email}`);
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose(false))}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{account.name || account.email}</DialogTitle>
          <DialogDescription>
            {account.email} · joined {formatDateTime(account.createdAt)}
            {account.pendingRequest ? ` · asked for ${account.pendingRequest}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 text-[13px] font-medium">
            <label htmlFor="manage-plan">Plan</label>
            <NativeSelect id="manage-plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
              {PLAN_IDS.map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {PLANS[id].name}
                  {PLANS[id].public ? "" : " (not sold)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5 text-[13px] font-medium">
            <label htmlFor="manage-credits">Add AI credits for this month</label>
            <Input
              id="manage-credits"
              inputMode="numeric"
              value={grant}
              onChange={(e) => setGrant(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={`Now ${account.creditsUsed.toLocaleString("en-US")} used of ${account.allowance.toLocaleString("en-US")}`}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-[13px] font-medium">
            <label htmlFor="manage-note">Note (only admins see it)</label>
            <Input
              id="manage-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Paid by GCash, ref 1234"
            />
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/20 p-3">
            <span className="text-[13px] font-medium">{account.suspended ? "Suspended" : "Suspend"}</span>
            <span className="text-[12.5px] text-muted-foreground">
              Pauses AI, API keys and automation emails. Sign-in and data stay.
            </span>
            <div className="flex gap-2">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                disabled={account.suspended}
              />
              {account.suspended ? (
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => void send({ suspend: null }, "Suspension lifted")}
                >
                  Lift
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={saving || !reason.trim()}
                  onClick={() => void send({ suspend: reason.trim() }, `Suspended ${account.email}`)}
                >
                  Suspend
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
