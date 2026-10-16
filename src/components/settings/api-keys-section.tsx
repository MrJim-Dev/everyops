"use client";

import { BookOpenIcon, CheckIcon, CopyIcon, KeyIcon, PlusIcon } from "@phosphor-icons/react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIONS, type Action } from "@/lib/activity";
import { type ApiKeyInfo, keyStatus, PERMISSION_LABELS, PERMISSIONS, type Permission } from "@/lib/api-keys";
import { formatDate, formatDateTime } from "@/lib/format";
import { useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { SettingsSection } from "./settings-section";

const EXPIRY: Record<string, { label: string; days: 30 | 90 | 365 | null }> = {
  "30": { label: "30 days", days: 30 },
  "90": { label: "90 days", days: 90 },
  "365": { label: "1 year", days: 365 },
  never: { label: "Never", days: null },
};
const DEFAULT_PERMISSIONS: Permission[] = ["records:read", "records:write", "pages:read", "mcp"];

/**
 * Account → API keys: keys for scripts, integrations and AI agents (the REST API and MCP). Each reaches every
 * workspace or a chosen few, with chosen permissions, never more than the owner's role. The secret shows once.
 */
export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [usage, setUsage] = useState<Record<string, KeyUsage>>({});
  const [open, setOpen] = useState(false);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const names = Object.fromEntries(Object.values(workspaces).map((w) => [w.slug, w.name]));

  const load = useCallback(async () => {
    const res = await fetch("/api/keys").catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok: boolean;
      keys?: ApiKeyInfo[];
      usage?: Record<string, KeyUsage>;
    } | null;
    setKeys(body?.keys ?? []);
    setUsage(body?.usage ?? {});
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (key: ApiKeyInfo) => {
    const res = await fetch(`/api/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
    if (!res.ok) return "That key couldn't be revoked. Try again.";
    toast.success(`Revoked “${key.name}”`, { description: "It stops working on its next request." });
    void load();
    return undefined;
  };

  const active = (keys ?? []).filter((k) => !k.revokedAt);
  return (
    <SettingsSection
      title="API keys"
      description="For scripts, integrations and AI agents such as Claude or ChatGPT. A key never does more than you can in a workspace."
      action={
        <div className="flex gap-2">
          <Button variant="ghost" render={<Link href="/developers" />} nativeButton={false}>
            <BookOpenIcon data-icon="inline-start" />
            API docs
          </Button>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            New API key
          </Button>
        </div>
      }
      footer={keys ? `${active.length} active` : undefined}
    >
      {keys === null ? (
        <div className="h-14 animate-pulse rounded-lg bg-muted/40" />
      ) : active.length ? (
        <ul className="-my-1 flex flex-col">
          {active.map((k) => {
            const status = keyStatus(k);
            return (
              <li key={k.id} className="flex items-start gap-3 border-b py-3 last:border-b-0">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                  <KeyIcon className="size-4 text-muted-foreground" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium">{k.name}</span>
                    <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
                      {k.prefix}…
                    </code>
                    {status === "expired" ? (
                      <span className="rounded-full border border-destructive/30 px-2 text-[11px] leading-5 text-destructive">
                        Expired
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[12.5px] text-muted-foreground">
                    {k.workspaces
                      ? k.workspaces.map((id) => names[id] ?? id).join(", ")
                      : "All your workspaces"}{" "}
                    · {k.permissions.map((p) => PERMISSION_LABELS[p].label.toLowerCase()).join(", ")}
                  </span>
                  <span className="text-[12px] text-muted-foreground/80">
                    Created {formatDate(k.createdAt, { withYear: true })}
                    {" · "}
                    {k.lastUsedAt ? `Last used ${formatDateTime(k.lastUsedAt)}` : "Never used"}
                    {" · "}
                    {k.expiresAt
                      ? `Expires ${formatDate(k.expiresAt, { withYear: true })}`
                      : "Doesn't expire"}
                  </span>
                  <KeyUse use={usage[k.id]} />
                </div>
                <ConfirmDeleteDialog
                  trigger={
                    <Button variant="ghost" size="sm" className="text-destructive">
                      Revoke
                    </Button>
                  }
                  title={`Revoke “${k.name}”?`}
                  description="Anything using this key stops working on its next request. This can't be undone."
                  label={`Type “${k.name}” to confirm`}
                  expected={k.name}
                  actionLabel="Revoke key"
                  onConfirm={() => revoke(k)}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No keys yet. Make one to use EveryOps from a script, Zapier, or an AI agent.
        </p>
      )}
      <NewKeyDialog
        open={open}
        onOpenChange={setOpen}
        workspaces={Object.values(workspaces)
          .filter((w) => w.loaded !== false || w.name)
          .map((w) => ({ id: w.slug, name: w.name }))}
        onCreated={load}
      />
    </SettingsSection>
  );
}

function NewKeyDialog({
  open,
  onOpenChange,
  workspaces,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set(DEFAULT_PERMISSIONS));
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAll(true);
    setPicked(new Set());
    setPermissions(new Set(DEFAULT_PERMISSIONS));
    setExpiry("90");
    setError(null);
    setSecret(null);
    setCopied(false);
  }, [open]);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          workspaces: all ? null : [...picked],
          permissions: [...permissions],
          expiresInDays: EXPIRY[expiry].days,
        }),
      });
      const body = (await res.json()) as { ok: boolean; secret?: string; message?: string };
      if (!body.ok || !body.secret) throw new Error(body.message ?? "The key couldn't be made.");
      setSecret(body.secret);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!secret) return;
    await navigator.clipboard.writeText(secret).catch(() => {});
    setCopied(true);
    toast.success("Key copied");
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const ready = name.trim() && permissions.size && (all || picked.size);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[600px]">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your new key</DialogTitle>
              <DialogDescription>
                This is the only time it's shown. Keep it somewhere safe, such as a password manager.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{secret}</code>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">Try it:</span>
              <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed">
                {`curl ${origin}/api/v1/workspaces \\\n  -H "Authorization: Bearer ${secret.slice(0, 17)}…"`}
              </pre>
            </div>
            {permissions.has("mcp") ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] text-muted-foreground">
                  Connect an AI agent (MCP, Streamable HTTP) at{" "}
                  <code className="font-mono text-foreground">{origin}/mcp</code>. Claude Code:
                </span>
                <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed">
                  {`claude mcp add --transport http everyops ${origin}/mcp \\\n  --header "Authorization: Bearer ${secret}"`}
                </pre>
                <span className="text-[12.5px] text-muted-foreground">
                  Cursor, VS Code and others (mcp.json):
                </span>
                <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed">
                  {JSON.stringify(
                    {
                      mcpServers: {
                        everyops: { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${secret}` } },
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : null}
            <DialogFooter className="mx-0 mb-0 rounded-b-none border-t-0 bg-transparent p-0">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                It can do what you choose here, and never more than your role allows in each workspace.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="key-name" className="text-[13px] font-medium">
                  Name
                </label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Claude Desktop, Zapier bookings"
                  maxLength={60}
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">Workspaces</legend>
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Checkbox id="key-all" checked={all} onCheckedChange={(v) => setAll(!!v)} />
                  <label htmlFor="key-all">All my workspaces, including new ones</label>
                </div>
                {!all ? (
                  <div className="ml-6 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                    {workspaces.map((w) => (
                      <div key={w.id} className="flex items-center gap-2.5 text-[13px]">
                        <Checkbox
                          id={`key-ws-${w.id}`}
                          checked={picked.has(w.id)}
                          onCheckedChange={() => setPicked((s) => toggle(s, w.id))}
                        />
                        <label htmlFor={`key-ws-${w.id}`}>{w.name}</label>
                      </div>
                    ))}
                  </div>
                ) : null}
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">Permissions</legend>
                {PERMISSIONS.map((p) => (
                  <div key={p} className="flex items-start gap-2.5 text-[13px]">
                    <Checkbox
                      id={`key-perm-${p}`}
                      checked={permissions.has(p)}
                      onCheckedChange={() => setPermissions((s) => toggle(s, p))}
                      className="mt-0.5"
                    />
                    <label htmlFor={`key-perm-${p}`} className="flex flex-col">
                      <span>{PERMISSION_LABELS[p].label}</span>
                      <span className="text-[12px] text-muted-foreground">{PERMISSION_LABELS[p].detail}</span>
                    </label>
                  </div>
                ))}
              </fieldset>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium">Expires</span>
                <Select
                  value={expiry}
                  onValueChange={(v) => setExpiry(String(v))}
                  items={Object.fromEntries(Object.entries(EXPIRY).map(([k, v]) => [k, v.label]))}
                >
                  <SelectTrigger size="sm" className="w-[140px]" aria-label="Expires">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {Object.entries(EXPIRY).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {error ? <p className={cn("text-[13px] text-destructive")}>{error}</p> : null}
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-b-none border-t-0 bg-transparent p-0">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!ready || busy} onClick={() => void create()}>
                {busy ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type KeyUsage = {
  total: number;
  denied: number;
  lastAt: string | null;
  lastAction: string | null;
  workspaces: number;
};

/** What a key did in the last 30 days, from the activity log: requests that changed or read data, and refusals. */
function KeyUse({ use }: { use?: KeyUsage }) {
  if (!use?.total) return null;
  return (
    <span className="text-[12px] text-muted-foreground/80">
      {use.total} logged action{use.total === 1 ? "" : "s"} in 30 days
      {use.workspaces > 1 ? ` across ${use.workspaces} workspaces` : ""}
      {use.lastAction ? ` · last: ${ACTIONS[use.lastAction as Action] ?? use.lastAction}` : ""}
      {use.denied ? (
        <span className="text-destructive">
          {" · "}
          {use.denied} refused
        </span>
      ) : null}
    </span>
  );
}
