"use client";

import { ArrowSquareOutIcon, CheckIcon, CopyIcon, GlobeIcon, StarIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspace-model";
import { cn } from "@/lib/utils";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { SettingsPage, SettingsSection } from "./settings-section";

type Domain = {
  hostname: string;
  target: string;
  kind: "custom" | "subdomain";
  status: "pending" | "verifying" | "issuing" | "live" | "error";
  message: string | null;
  primary: boolean;
  checkedAt: string | null;
  records: { type: string; name: string; value: string; why: string }[];
};

type Data = {
  domains: Domain[];
  pages: { id: string; name: string }[];
  platformReady: boolean;
};

const STEPS = [
  { id: "pending", label: "Waiting for DNS" },
  { id: "verifying", label: "Verifying" },
  { id: "issuing", label: "Issuing certificate" },
  { id: "live", label: "Live" },
] as const;

function Steps({ status }: { status: Domain["status"] }) {
  const at = status === "error" ? 0 : STEPS.findIndex((s) => s.id === status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2 leading-5",
              i < at || status === "live"
                ? "border-success/30 text-success"
                : i === at
                  ? status === "error"
                    ? "border-destructive/40 text-destructive"
                    : "border-foreground/30 text-foreground"
                  : "text-muted-foreground/70",
            )}
          >
            {i === at && status === "error" ? "Needs a fix" : s.label}
          </span>
          {i < STEPS.length - 1 ? <span className="text-muted-foreground/50">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`Copy ${value}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

/** Settings → Domains: the workspace's public pages on its own domain, with the DNS to add and where setup is at. */
export function DomainSettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role) && ws.mode === "live";
  const base = `/api/workspaces/${encodeURIComponent(ws.id)}/domains`;
  const [data, setData] = useState<Data | null>(null);
  const [host, setHost] = useState("");
  const [target, setTarget] = useState("home");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null);
    setData(
      (await res?.json().catch(() => null)) ?? {
        domains: [],
        pages: [],
        platformReady: false,
      },
    );
  }, [base]);
  useEffect(() => {
    if (manager) void load();
  }, [load, manager]);

  if (!manager)
    return (
      <SettingsPage>
        <SettingsSection
          title="Domains"
          description="Only the workspace's owners and admins can manage its domains."
        />
      </SettingsPage>
    );

  const add = async (body: object) => {
    setBusy("add");
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    setBusy(null);
    if (!out?.ok) return toast.error(out?.message ?? "That domain couldn't be added.");
    setHost("");
    void load();
  };
  const act = async (d: Domain, action: "check" | "primary") => {
    setBusy(`${action}:${d.hostname}`);
    await fetch(`${base}/${encodeURIComponent(d.hostname)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setBusy(null);
    void load();
  };
  const pageName = (id: string) =>
    id === "home" ? "Public home" : (data?.pages.find((p) => p.id === id)?.name ?? id);
  const open = (h: string) =>
    h.endsWith(".localhost") ? `http://${h}:${window.location.port}/` : `https://${h}/`;

  return (
    <SettingsPage>
      <SettingsSection
        title="Domains"
        description="Put your public pages on your own address, like book.myresort.com for the booking form or myresort.com for your site. Visitors stay on your domain; sign-in stays on EveryOps."
        footer={
          data && !data.platformReady
            ? "DNS checks work now. Certificates start once the custom-domain load balancer is switched on."
            : undefined
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <label
            htmlFor="domain-host"
            className="flex min-w-[240px] flex-1 flex-col gap-1 text-[12px] text-muted-foreground"
          >
            Domain
            <Input
              id="domain-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="book.myresort.com"
            />
          </label>
          <label htmlFor="domain-target" className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            Shows
            <NativeSelect id="domain-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <NativeSelectOption value="home">Public home</NativeSelectOption>
              {data?.pages.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            disabled={!host.trim() || busy === "add"}
            onClick={() => void add({ hostname: host, target })}
          >
            Add domain
          </Button>
        </div>
        {data === null ? (
          <Skeleton className="h-28 rounded-lg" />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.domains.map((d) => (
              <li key={d.hostname} className="flex flex-col gap-3 rounded-lg border p-3.5">
                <div className="flex flex-wrap items-start gap-3">
                  <GlobeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13.5px] font-medium">{d.hostname}</span>
                      {d.primary ? (
                        <span className="flex items-center gap-1 rounded-full border px-2 text-[11px] leading-5 text-muted-foreground">
                          <StarIcon className="size-3" weight="fill" /> Primary
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[12.5px] text-muted-foreground">
                      Shows {pageName(d.target)}
                      {d.checkedAt ? ` · checked ${formatDateTime(d.checkedAt)}` : ""}
                    </span>
                    <Steps status={d.status} />
                    {d.message ? (
                      <span
                        className={cn(
                          "text-[12.5px]",
                          d.status === "error" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {d.message}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.status === "live" ? (
                      <a
                        href={open(d.hostname)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] hover:bg-muted"
                      >
                        <ArrowSquareOutIcon className="size-3.5" /> Open
                      </a>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === `check:${d.hostname}`}
                        onClick={() => void act(d, "check")}
                      >
                        Check now
                      </Button>
                    )}
                    {!d.primary && d.target === "home" ? (
                      <Button size="sm" variant="ghost" onClick={() => void act(d, "primary")}>
                        Make primary
                      </Button>
                    ) : null}
                    <ConfirmDeleteDialog
                      trigger={
                        <Button size="sm" variant="ghost" className="text-destructive">
                          Remove
                        </Button>
                      }
                      title={`Remove ${d.hostname}?`}
                      description="It stops showing your pages at once and its certificate is deleted. Remove its DNS record too, so nobody else can claim it."
                      label="Type the domain to confirm"
                      expected={d.hostname}
                      actionLabel="Remove domain"
                      onConfirm={async () => {
                        const res = await fetch(`${base}/${encodeURIComponent(d.hostname)}`, {
                          method: "DELETE",
                        });
                        const out = (await res.json().catch(() => null)) as {
                          ok?: boolean;
                          warning?: string;
                        } | null;
                        if (!out?.ok) return "It couldn't be removed. Try again.";
                        if (out.warning) toast.warning(out.warning);
                        void load();
                        return undefined;
                      }}
                    />
                  </div>
                </div>
                {d.status !== "live" && d.records.length ? (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-[12.5px]">
                      <thead className="bg-muted/30 text-muted-foreground">
                        <tr>
                          <th className="px-2.5 py-1.5 font-medium">Type</th>
                          <th className="px-2.5 py-1.5 font-medium">Name</th>
                          <th className="px-2.5 py-1.5 font-medium">Value</th>
                          <th className="px-2.5 py-1.5 font-medium">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.records.map((r) => (
                          <tr key={r.type + r.name + r.value} className="border-t">
                            <td className="px-2.5 py-1.5 font-mono">{r.type}</td>
                            <td className="px-2.5 py-1.5 font-mono">
                              {r.name} <Copy value={r.name} />
                            </td>
                            <td className="px-2.5 py-1.5 font-mono">
                              {r.value} <Copy value={r.value} />
                            </td>
                            <td className="px-2.5 py-1.5 text-muted-foreground">{r.why}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
