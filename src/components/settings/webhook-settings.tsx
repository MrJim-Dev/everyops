"use client";

import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspace-model";
import { cn } from "@/lib/utils";
import { EVENT_LABELS, urlProblem, WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { SettingsPage, SettingsSection } from "./settings-section";

type Endpoint = {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  entityIds: string[] | null;
  enabled: boolean;
  disabledReason: string | null;
  failures: number;
  lastSuccessAt: string | null;
  recent: { delivered: number; failed: number; pending: number };
};

type Delivery = {
  id: number;
  eventId: string;
  eventType: string;
  status: "pending" | "sending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  durationMs: number | null;
  createdAt: string;
  nextAttemptAt: string | null;
  payload: unknown;
};

const DEFAULT_EVENTS: WebhookEvent[] = ["record.created", "record.status_changed", "public_form.submitted"];

/** Settings → Webhooks: endpoints that get an HTTPS POST, signed, whenever records change. */
export function WebhookSettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role) && ws.mode === "live";
  const base = `/api/workspaces/${encodeURIComponent(ws.id)}/webhooks`;
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { endpoints?: Endpoint[] } | null;
    setEndpoints(body?.endpoints ?? []);
  }, [base]);
  useEffect(() => {
    if (manager) void load();
  }, [load, manager]);

  if (!manager)
    return (
      <SettingsPage>
        <SettingsSection
          title="Webhooks"
          description="Only the workspace's owners and admins can manage webhooks."
        />
      </SettingsPage>
    );

  const typeName = (id: string) => ws.blueprint.entities.find((e) => e.id === id)?.pluralName ?? id;

  return (
    <SettingsPage>
      <SettingsSection
        title="Webhooks"
        description="Send new bookings, status changes and form submissions to Slack, Zapier, Make or your own systems the moment they happen. Each delivery is an HTTPS POST signed with the endpoint's secret; failures are retried for 24 hours."
        footer={endpoints ? `${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}` : undefined}
        action={
          <Button variant="outline" onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add endpoint
          </Button>
        }
      >
        {endpoints === null ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : endpoints.length ? (
          <ul className="-my-1 flex flex-col">
            {endpoints.map((e) => (
              <EndpointRow
                key={e.id}
                endpoint={e}
                base={base}
                typeName={typeName}
                expanded={shown === e.id}
                onToggle={() => setShown((s) => (s === e.id ? null : e.id))}
                onChanged={load}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No endpoints yet. Add one to get a POST whenever a booking comes in or changes.
          </p>
        )}
      </SettingsSection>
      <NewEndpointDialog open={open} onOpenChange={setOpen} base={base} onCreated={load} />
    </SettingsPage>
  );
}

function EndpointRow({
  endpoint: e,
  base,
  typeName,
  expanded,
  onToggle,
  onChanged,
}: {
  endpoint: Endpoint;
  base: string;
  typeName: (id: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const url = `${base}/${e.id}`;
  const patch = async (body: object) => {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) toast.error("That didn't save. Try again.");
    onChanged();
    return res.ok ? ((await res.json()) as { secret?: string }) : null;
  };
  const test = async () => {
    const res = await fetch(`${url}/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    if (res.ok) toast.success("Test event sent", { description: "It shows under Deliveries in a moment." });
    if (!expanded) onToggle();
  };
  const reveal = async () => {
    const res = await fetch(url);
    const body = (await res.json().catch(() => null)) as { secret?: string } | null;
    if (!body?.secret) return;
    await navigator.clipboard.writeText(body.secret).catch(() => {});
    toast.success("Signing secret copied", { description: `${body.secret.slice(0, 12)}…` });
  };
  const status = !e.enabled
    ? { label: "Off", tone: "border-destructive/30 text-destructive" }
    : e.failures
      ? { label: `${e.failures} failing`, tone: "border-warning/40 text-warning" }
      : { label: "Active", tone: "border-success/30 text-success" };

  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <WebhooksLogoIcon className="size-4 text-muted-foreground" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 truncate font-mono text-[13px]">{e.url}</code>
            <span className={cn("rounded-full border px-2 text-[11px] leading-5", status.tone)}>
              {status.label}
            </span>
          </div>
          {e.description ? <span className="text-[13px]">{e.description}</span> : null}
          <span className="text-[12.5px] text-muted-foreground">
            {e.events.map((x) => EVENT_LABELS[x] ?? x).join(" · ")}
            {e.entityIds?.length ? ` — ${e.entityIds.map(typeName).join(", ")} only` : ""}
          </span>
          <span className="text-[12px] text-muted-foreground/80">
            Last 7 days: {e.recent.delivered} delivered
            {e.recent.failed ? ` · ${e.recent.failed} failed` : ""}
            {e.recent.pending ? ` · ${e.recent.pending} waiting to retry` : ""}
            {e.lastSuccessAt ? ` · last success ${formatDateTime(e.lastSuccessAt)}` : ""}
          </span>
          {e.disabledReason ? <span className="text-[12px] text-destructive">{e.disabledReason}</span> : null}
        </div>
        <Switch
          checked={e.enabled}
          onCheckedChange={(v) => void patch({ enabled: v })}
          aria-label={e.enabled ? "Turn endpoint off" : "Turn endpoint on"}
        />
      </div>
      <div className="ml-11 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={!e.enabled}>
          <PaperPlaneTiltIcon data-icon="inline-start" />
          Send test
        </Button>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {expanded ? "Hide deliveries" : "Deliveries"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void reveal()}>
          <EyeIcon data-icon="inline-start" />
          Copy secret
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const done = await patch({ rotateSecret: true });
            if (done?.secret) {
              await navigator.clipboard.writeText(done.secret).catch(() => {});
              toast.success("New secret copied", { description: "The old one stops working now." });
            }
          }}
        >
          <ArrowClockwiseIcon data-icon="inline-start" />
          Rotate secret
        </Button>
        <ConfirmDeleteDialog
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              Delete
            </Button>
          }
          title="Delete this endpoint?"
          description="It stops getting events at once, and its delivery history goes too."
          label="Type delete to confirm"
          expected="delete"
          actionLabel="Delete endpoint"
          onConfirm={async () => {
            const res = await fetch(url, { method: "DELETE" });
            if (!res.ok) return "It couldn't be deleted. Try again.";
            onChanged();
            return undefined;
          }}
        />
      </div>
      {expanded ? <Deliveries url={`${url}/deliveries`} onResent={onChanged} /> : null}
    </li>
  );
}

const STATUS: Record<Delivery["status"], { label: string; tone: string }> = {
  delivered: { label: "Delivered", tone: "text-success" },
  pending: { label: "Retrying", tone: "text-warning" },
  sending: { label: "Sending", tone: "text-muted-foreground" },
  failed: { label: "Failed", tone: "text-destructive" },
};

/** An endpoint's recent deliveries, refreshed every few seconds while open (with the endpoint's counts). */
function Deliveries({ url, onResent }: { url: string; onResent: () => void }) {
  const [items, setItems] = useState<Delivery[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(url).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { deliveries?: Delivery[] } | null;
    setItems(body?.deliveries ?? []);
    onResent();
  }, [url, onResent]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);
  const resend = async (id: number) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resend: id }),
    });
    if (res.ok)
      toast.success("Sent again", { description: "Same event id, so the receiver can skip duplicates." });
    void load();
  };
  if (items === null) return <Skeleton className="ml-11 h-24 rounded-lg" />;
  if (!items.length) return <p className="ml-11 text-[12.5px] text-muted-foreground">Nothing sent yet.</p>;
  return (
    <div className="ml-11 overflow-hidden rounded-lg border">
      {items.map((d) => {
        const s = STATUS[d.status];
        return (
          <div key={d.id} className="border-b last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
              <button
                type="button"
                className="font-mono text-[12px] hover:underline"
                onClick={() => setOpen((o) => (o === d.id ? null : d.id))}
              >
                {d.eventType}
              </button>
              <span className={cn("font-medium", s.tone)}>{s.label}</span>
              <span className="text-muted-foreground">
                {[
                  d.lastStatus ? `HTTP ${d.lastStatus}` : d.lastError,
                  d.durationMs !== null ? `${d.durationMs} ms` : null,
                  `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}`,
                  d.nextAttemptAt && d.status === "pending" && d.attempts
                    ? `next ${formatDateTime(d.nextAttemptAt)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="ml-auto text-muted-foreground">{formatDateTime(d.createdAt)}</span>
              <Button size="xs" variant="ghost" onClick={() => void resend(d.id)}>
                Resend
              </Button>
            </div>
            {open === d.id ? (
              <pre className="max-h-64 overflow-auto border-t bg-muted/30 px-3 py-2 font-mono text-[11.5px] leading-relaxed">
                {JSON.stringify(d.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NewEndpointDialog({
  open,
  onOpenChange,
  base,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string;
  onCreated: () => void;
}) {
  const ws = useWorkspace();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(DEFAULT_EVENTS));
  const [allTypes, setAllTypes] = useState(true);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setDescription("");
    setEvents(new Set(DEFAULT_EVENTS));
    setAllTypes(true);
    setTypes(new Set());
    setError(null);
    setSecret(null);
    setCopied(false);
  }, [open]);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  };

  const problem = url.trim() ? urlProblem(url.trim()) : null;
  const ready = url.trim() && !problem && events.size && (allTypes || types.size);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          description: description.trim() || null,
          events: [...events],
          entityIds: allTypes ? null : [...types],
        }),
      });
      const body = (await res.json()) as { ok: boolean; secret?: string; message?: string };
      if (!body.ok || !body.secret) throw new Error(body.message ?? "The endpoint couldn't be added.");
      setSecret(body.secret);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[600px]">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Endpoint added</DialogTitle>
              <DialogDescription>
                Use this secret to check each delivery's EveryOps-Signature header. You can copy it again from
                the endpoint later.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{secret}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(secret).catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">Check a delivery (Node):</span>
              <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed">
                {`const [t, v1] = req.headers["everyops-signature"].split(",").map((p) => p.split("=")[1]);
const expected = crypto.createHmac("sha256", SECRET).update(t + "." + rawBody).digest("hex");
const ok = expected === v1 && Math.abs(Date.now() / 1000 - Number(t)) < 300;`}
              </pre>
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-b-none border-t-0 bg-transparent p-0">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add a webhook endpoint</DialogTitle>
              <DialogDescription>
                EveryOps sends a signed POST here each time one of these happens.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hook-url" className="text-[13px] font-medium">
                  URL
                </label>
                <Input
                  id="hook-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://hooks.zapier.com/hooks/catch/…"
                  aria-invalid={!!problem}
                />
                {problem ? <span className="text-[12px] text-destructive">{problem}</span> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hook-description" className="text-[13px] font-medium">
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="hook-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. New bookings to Slack #front-desk"
                  maxLength={200}
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">Events</legend>
                {WEBHOOK_EVENTS.map((ev) => (
                  <div key={ev} className="flex items-center gap-2.5 text-[13px]">
                    <Checkbox
                      id={`hook-ev-${ev}`}
                      checked={events.has(ev)}
                      onCheckedChange={() => setEvents((s) => toggle(s, ev))}
                    />
                    <label
                      htmlFor={`hook-ev-${ev}`}
                      className="flex flex-1 items-baseline justify-between gap-3"
                    >
                      {EVENT_LABELS[ev]}
                      <code className="font-mono text-[11.5px] text-muted-foreground">{ev}</code>
                    </label>
                  </div>
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">Record types</legend>
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox id="hook-all" checked={allTypes} onCheckedChange={(v) => setAllTypes(!!v)} />
                  <label htmlFor="hook-all">All record types</label>
                </div>
                {!allTypes ? (
                  <div className="ml-6 grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto">
                    {ws.blueprint.entities.map((en) => (
                      <div key={en.id} className="flex items-center gap-2.5 text-[13px]">
                        <Checkbox
                          id={`hook-type-${en.id}`}
                          checked={types.has(en.id)}
                          onCheckedChange={() => setTypes((s) => toggle(s, en.id))}
                        />
                        <label htmlFor={`hook-type-${en.id}`}>{en.pluralName}</label>
                      </div>
                    ))}
                  </div>
                ) : null}
              </fieldset>
              {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-b-none border-t-0 bg-transparent p-0">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!ready || busy} onClick={() => void create()}>
                {busy ? "Adding…" : "Add endpoint"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
