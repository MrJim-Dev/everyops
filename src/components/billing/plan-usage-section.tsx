"use client";

import { EnvelopeSimpleIcon, LightningIcon, PauseCircleIcon, SealCheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { featureLabel } from "@/lib/ai-usage";
import { authClient } from "@/lib/auth/client";
import { API_LABEL, CREDIT_PACKS, formatPeso, isUnlimited, PLANS, type PlanId } from "@/lib/billing/plans";
import { formatBytes, type PlanUsage } from "@/lib/billing/usage";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type CheckoutBody, requestCheckout } from "./checkout";
import { Meter } from "./meter";
import { PlanPicker } from "./plan-picker";

const SOURCE_NOTE: Record<PlanUsage["source"], string> = {
  assigned: "",
  default: "Every account starts on Free.",
  "site-admin": "Site admins are on Internal.",
  demo: "The shared demo account has its own limits.",
};

/** Account → Plan & usage: the plan, this month's AI credits, every limit as a meter, and upgrading. */
export function PlanUsageSection() {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<"plans" | "credits" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(() => {
    fetch("/api/account/plan")
      .then((r) => r.json())
      .then((b: { ok: boolean; usage?: PlanUsage }) =>
        b.ok && b.usage ? setUsage(b.usage) : setFailed(true),
      )
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const ask = async (key: string, body: CheckoutBody) => {
    setBusy(key);
    const answer = await requestCheckout(body);
    setBusy(null);
    if (!answer.ok) return toast.error(answer.message);
    if (answer.mode === "manual") {
      setSent(answer.message);
      load();
    }
  };

  const verify = async () => {
    if (!usage) return;
    setVerifying(true);
    const { error } = await authClient.sendVerificationEmail({
      email: usage.email,
      callbackURL: "/account#plan",
    });
    setVerifying(false);
    if (error) return toast.error(error.message ?? "Couldn't send the link. Try again in a minute.");
    toast.success("Check your inbox", { description: `We sent a link to ${usage.email}.` });
  };

  if (failed) return null;
  const plan = usage ? PLANS[usage.plan] : null;
  const l = plan?.limits;
  const creditsLeft = usage ? Math.max(0, usage.credits.allowance - usage.credits.used) : 0;
  const selling = usage && (usage.source === "default" || usage.source === "assigned");

  return (
    <div id="plan" className="scroll-mt-20">
      <SettingsSection
        title="Plan & usage"
        description="What your plan includes and how much of it this account has used. AI in your workspaces counts to you, including what your team asks there."
        footer={
          usage
            ? `AI credits renew on ${formatDate(usage.renewsOn, { withYear: true })}. 1 credit is about ₱0.06 of AI.`
            : undefined
        }
        action={
          usage && selling ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog("credits")}>
                Add credits
              </Button>
              <Button size="sm" onClick={() => setDialog("plans")}>
                {usage.plan === "free" ? "Upgrade" : "Change plan"}
              </Button>
            </>
          ) : undefined
        }
      >
        {!usage || !plan || !l ? (
          <Skeleton className="h-56" />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[20px] font-semibold tracking-tight">{plan.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {plan.monthlyCentavos ? `${formatPeso(plan.monthlyCentavos)}/month` : "No charge"}
              </span>
              {usage.suspended ? (
                <Badge variant="destructive">Suspended</Badge>
              ) : usage.status !== "active" ? (
                <Badge variant="outline">{usage.status.replace("_", " ")}</Badge>
              ) : null}
              {SOURCE_NOTE[usage.source] ? (
                <span className="text-[12.5px] text-muted-foreground">{SOURCE_NOTE[usage.source]}</span>
              ) : null}
            </div>

            {!usage.verified && usage.source !== "demo" && usage.source !== "site-admin" ? (
              <Notice icon={<EnvelopeSimpleIcon />} tone="warn">
                <span>
                  Confirm <strong className="font-medium">{usage.email}</strong> to use AI. It keeps free
                  credits for real people.
                </span>
                <Button size="sm" variant="outline" disabled={verifying} onClick={() => void verify()}>
                  {verifying ? "Sending…" : "Send link"}
                </Button>
              </Notice>
            ) : null}
            {usage.suspended ? (
              <Notice icon={<PauseCircleIcon />} tone="danger">
                AI, the API and automation emails are paused on this account
                {usage.suspendedReason ? `: ${usage.suspendedReason.replace(/\.?$/, ".")}` : "."} Your data is
                untouched. Contact the EveryOps team to sort it out.
              </Notice>
            ) : null}
            {usage.safetySwitchOn && plan.pausedBySafetySwitch ? (
              <Notice icon={<PauseCircleIcon />} tone="warn">
                AI on free accounts is paused for the rest of today because of unusually high use. It's back
                tomorrow, or right away on a paid plan.
              </Notice>
            ) : null}
            {sent ? (
              <Notice icon={<SealCheckIcon />} tone="ok">
                {sent}
              </Notice>
            ) : null}

            <div className="flex flex-col gap-3 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-[12.5px] text-muted-foreground">AI credits left this month</span>
                  <span className="font-mono text-[26px] leading-tight tabular-nums">
                    {creditsLeft.toLocaleString("en-US")}
                  </span>
                </div>
                <span className="text-[12.5px] text-muted-foreground">
                  {usage.credits.used.toLocaleString("en-US")} used of{" "}
                  {usage.credits.allowance.toLocaleString("en-US")}
                  {usage.credits.bonus
                    ? ` (${usage.credits.bonus.toLocaleString("en-US")} added this month)`
                    : ""}
                </span>
              </div>
              <Meter label="Used" used={usage.credits.used} limit={usage.credits.allowance} />
              {usage.byFeature.length ? (
                <ul className="grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                  {usage.byFeature.slice(0, 6).map((f) => (
                    <li key={f.feature} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        {featureLabel(f.feature)} · {f.requests} {f.requests === 1 ? "time" : "times"}
                      </span>
                      <span className="font-mono tabular-nums">{f.credits.toLocaleString("en-US")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">No AI used yet this month.</p>
              )}
              <p className="text-[12px] text-muted-foreground">
                A new workspace design takes about 130 credits, a setup conversation about 25 and an Ask
                EveryOps answer 10 to 60, more in big workspaces.
              </p>
            </div>

            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Meter
                label="Workspaces"
                used={usage.workspaces.used}
                limit={l.workspaces}
                hint={
                  usage.workspaces.starter
                    ? `Plus ${usage.workspaces.starter} starter workspaces, free`
                    : undefined
                }
              />
              <Meter
                label="Team members (largest workspace)"
                used={usage.members.used}
                limit={l.members}
                hint={usage.members.workspace ?? undefined}
              />
              <Meter
                label="Records (largest workspace)"
                used={usage.records.used}
                limit={l.records}
                hint={usage.records.workspace ?? undefined}
              />
              <Meter
                label="File storage"
                used={usage.storageBytes}
                limit={l.storageMb * 1_000_000}
                unlimited={isUnlimited(l.storageMb)}
                show={formatBytes}
              />
              <Meter label="Automation emails today" used={usage.emailsToday} limit={l.emailsPerDay} />
              <Meter label="Custom domains" used={usage.customDomains} limit={l.customDomains} />
              <Meter label="Workspace designs today" used={usage.today.designs} limit={l.designsPerDay} />
              <Meter label="Setup messages today" used={usage.today.turns} limit={l.interviewTurnsPerDay} />
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              API, MCP and webhooks: <span className="text-foreground">{API_LABEL[l.api]}</span>
              {usage.apiKeys ? ` · ${usage.apiKeys} active key${usage.apiKeys === 1 ? "" : "s"}` : ""}. Over a
              limit after changing plans? Nothing is deleted; you just can't add more until you're back under
              it.{" "}
              <Link href="/pricing" className="underline underline-offset-2 hover:text-foreground">
                Compare plans
              </Link>
            </p>
            {usage.requests.length ? (
              <p className="text-[12.5px] text-muted-foreground">
                Requested: {usage.requests.map((r) => describe(r.detail)).join(", ")}. The team will email
                you.
              </p>
            ) : null}
          </div>
        )}
      </SettingsSection>

      <Dialog open={dialog === "plans"} onOpenChange={(o) => setDialog(o ? "plans" : null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>Choose a plan</DialogTitle>
            <DialogDescription>
              {usage && !usage.paymentsOnline
                ? "Online payment is coming soon. Choose a plan and the EveryOps team will email you how to pay (GCash, Maya, bank or card), then switch you over."
                : "You'll pay on the next screen."}
            </DialogDescription>
          </DialogHeader>
          {sent ? (
            <Notice icon={<SealCheckIcon />} tone="ok">
              {sent}
            </Notice>
          ) : null}
          <PlanPicker
            compact
            current={usage?.plan as PlanId | undefined}
            busy={busy as PlanId | null}
            onChoose={(p, period) => void ask(p, { kind: "plan", plan: p, period })}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "credits"} onOpenChange={(o) => setDialog(o ? "credits" : null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add AI credits</DialogTitle>
            <DialogDescription>
              Credits are added for this month, on top of your plan. Online payment is coming soon; the team
              will email you how to pay.
            </DialogDescription>
          </DialogHeader>
          {sent ? (
            <Notice icon={<SealCheckIcon />} tone="ok">
              {sent}
            </Notice>
          ) : null}
          <div className="flex flex-col gap-2">
            {CREDIT_PACKS.map((pack) => (
              <div key={pack.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <LightningIcon className="size-4 text-primary" weight="fill" />
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium">
                      {pack.credits.toLocaleString("en-US")} credits
                    </span>
                    <span className="text-[12.5px] text-muted-foreground">{formatPeso(pack.centavos)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === pack.id}
                  onClick={() => void ask(pack.id, { kind: "credits", pack: pack.id })}
                >
                  {busy === pack.id ? "Sending…" : "Request"}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function describe(d: Record<string, unknown>) {
  if (d.item === "plan") return `${PLANS[d.plan as PlanId]?.name ?? String(d.plan)} (${String(d.period)})`;
  return `${Number(d.credits).toLocaleString("en-US")} credits`;
}

function Notice({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "ok" | "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "ok" && "border-primary/30 bg-primary/[0.06]",
        tone === "warn" && "border-amber-400/30 bg-amber-400/[0.06] [&>svg]:text-amber-400",
        tone === "danger" && "border-destructive/30 bg-destructive/[0.06] [&>svg]:text-destructive",
      )}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">{children}</div>
    </div>
  );
}
