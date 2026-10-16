"use client";

import {
  CalendarBlankIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  PlugsConnectedIcon,
} from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { OutsideActions } from "@/components/assistant/outside-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { OutsideAction, ProviderId } from "@/lib/connections";
import { formatDate } from "@/lib/format";
import { canManage } from "@/lib/store/workspace-model";
import { cn } from "@/lib/utils";
import { SettingsPage, SettingsSection } from "./settings-section";

type Provider = {
  id: ProviderId;
  name: string;
  description: string;
  reads: string[];
  writes: string[];
  connection: { accountEmail: string | null; connectedBy: string | null; connectedAt: string } | null;
};

const ICON: Record<ProviderId, typeof CalendarBlankIcon> = {
  google_calendar: CalendarBlankIcon,
  gmail: EnvelopeSimpleIcon,
};

const words = (tools: string[]) => tools.map((t) => t.replaceAll("_", " ")).join(", ");

const ERRORS: Record<string, string> = {
  expired: "That connection attempt expired. Try again.",
  account: "Finish connecting while signed in to the account that started it.",
  role: "Only owners and admins can connect services.",
  access_denied: "Google's screen was cancelled, so nothing was connected.",
};

/** Settings → Connections: outside services Ask EveryOps can read (and propose changes to, for you to approve). */
export function ConnectionSettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role) && ws.mode === "live";
  const base = `/api/workspaces/${encodeURIComponent(ws.id)}/connections`;
  const params = useSearchParams();
  const [data, setData] = useState<{
    available: boolean;
    providers: Provider[];
    actions: OutsideAction[];
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null);
    setData((await res?.json().catch(() => null)) ?? { available: false, providers: [], actions: [] });
  }, [base]);
  useEffect(() => {
    if (manager) void load();
  }, [load, manager]);
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast.success("Connected", { description: "Ask EveryOps can use it now." });
    if (error) toast.error("Not connected", { description: ERRORS[error] ?? error });
  }, [params]);

  if (!manager)
    return (
      <SettingsPage>
        <SettingsSection
          title="Connections"
          description="Only the workspace's owners and admins can connect outside services."
        />
      </SettingsPage>
    );

  const disconnect = async (p: Provider) => {
    const res = await fetch(`${base}/${p.id}`, { method: "DELETE" });
    if (res.ok)
      toast.success(`${p.name} disconnected`, { description: "Ask EveryOps can't use it anymore." });
    void load();
  };

  return (
    <SettingsPage>
      <SettingsSection
        title="Connections"
        description="Let Ask EveryOps check your Google Calendar or Gmail while it answers, such as which bookings clash with your meetings. It only reads; anything it would change there, like a new event or an email draft, waits for you to press Apply."
      >
        {data === null ? (
          <Skeleton className="h-28 rounded-lg" />
        ) : (
          <ul className="-my-1 flex flex-col">
            {data.providers.map((p) => {
              const Icon = ICON[p.id] ?? PlugsConnectedIcon;
              return (
                <li key={p.id} className="flex items-start gap-3 border-b py-3 last:border-b-0">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                    <Icon className="size-4.5 text-muted-foreground" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium">{p.name}</span>
                      {p.connection ? (
                        <span className="flex items-center gap-1 rounded-full border border-success/30 px-2 text-[11px] leading-5 text-success">
                          <CheckCircleIcon className="size-3" />
                          Connected
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[13px] text-foreground/85">{p.description}</span>
                    <span className="text-[12px] text-muted-foreground">
                      Reads: {words(p.reads)}. Proposes, for your approval: {words(p.writes)}.
                    </span>
                    {p.connection ? (
                      <span className="text-[12px] text-muted-foreground/80">
                        {p.connection.accountEmail ?? "Google account"} · connected by{" "}
                        {p.connection.connectedBy ?? "an admin"} on{" "}
                        {formatDate(p.connection.connectedAt, { withYear: true })}
                      </span>
                    ) : null}
                  </div>
                  {p.connection ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void disconnect(p)}
                    >
                      Disconnect
                    </Button>
                  ) : data.available ? (
                    <a
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      href={`${base}/${p.id}`}
                    >
                      Connect
                    </a>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">Google isn't set up here</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
      {data?.actions.some((a) => a.status === "proposed") ? (
        <SettingsSection
          title="Waiting for your approval"
          description="Changes Ask EveryOps proposed in connected services. Nothing has run; Apply runs one now."
        >
          <OutsideActions actions={data.actions.filter((a) => a.status === "proposed")} />
        </SettingsSection>
      ) : null}
      {data?.actions.some((a) => a.status !== "proposed") ? (
        <SettingsSection
          title="Outside actions"
          description="What Ask EveryOps proposed in connected services, and what you decided."
        >
          <ul className="-my-1 flex flex-col">
            {data.actions
              .filter((a) => a.status !== "proposed")
              .map((a) => (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-3 border-b py-2.5 text-[13px] last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <span>{a.summary}</span>
                    <span className="truncate text-[12px] text-muted-foreground">
                      {a.tool.replaceAll("_", " ")}
                      {a.result && a.status === "failed" ? ` · ${a.result}` : ""}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 text-[11px] leading-5",
                      a.status === "applied"
                        ? "border-success/30 text-success"
                        : a.status === "failed"
                          ? "border-destructive/30 text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {a.status === "proposed" ? "Waiting" : a.status[0].toUpperCase() + a.status.slice(1)}
                  </span>
                </li>
              ))}
          </ul>
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}
