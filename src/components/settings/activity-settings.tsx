"use client";

import {
  BrowserIcon,
  CaretDownIcon,
  DownloadSimpleIcon,
  KeyIcon,
  LightningIcon,
  LinkSimpleIcon,
  RobotIcon,
  TableIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  ACTIONS,
  ACTOR_LABELS,
  ACTOR_TYPES,
  type ActivityItem,
  type ActorType,
  describeActivity,
  RETENTION_DAYS,
} from "@/lib/activity";
import { recordTitle } from "@/lib/blueprint/lookup";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspace-model";
import { cn } from "@/lib/utils";
import { SettingsPage, SettingsSection } from "./settings-section";

const ICONS: Record<ActorType, typeof UserIcon> = {
  person: UserIcon,
  api_key: KeyIcon,
  mcp_client: RobotIcon,
  automation: LightningIcon,
  public_form: BrowserIcon,
  booking_link: LinkSimpleIcon,
  sheet_sync: TableIcon,
};

const RESULT_STYLE: Record<ActivityItem["result"], { label: string; tone: string } | null> = {
  ok: null,
  denied: { label: "Denied", tone: "border-destructive/30 text-destructive" },
  conflict: { label: "Conflict", tone: "border-warning/40 text-warning" },
  error: { label: "Failed", tone: "border-destructive/30 text-destructive" },
};

const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "record.", label: "Record changes" },
  ...Object.entries(ACTIONS)
    .filter(([a]) => !a.startsWith("key."))
    .map(([value, label]) => ({ value, label })),
];

type Filters = { actor: string; action: string; result: string; from: string; to: string };
const EMPTY: Filters = { actor: "", action: "", result: "", from: "", to: "" };

/** Settings → Activity: who or what changed this workspace (people, API keys, AI agents, automations, forms). */
export function ActivitySettings() {
  const ws = useWorkspace();
  const manager = canManage(ws.role) && ws.mode === "live";
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [actors, setActors] = useState<{ type: ActorType; id: string; name: string }[]>([]);
  const [failed, setFailed] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (filters.actor) {
      const [type, ...id] = filters.actor.split(":");
      q.set("actorType", type);
      if (id.length) q.set("actor", id.join(":"));
    }
    for (const k of ["action", "result", "from", "to"] as const) if (filters[k]) q.set(k, filters[k]);
    return q;
  }, [filters]);

  const load = useCallback(
    async (before?: number) => {
      const q = new URLSearchParams(query);
      if (before) q.set("before", String(before));
      else q.set("actors", "1");
      const res = await fetch(`/api/workspaces/${encodeURIComponent(ws.id)}/activity?${q}`);
      if (!res.ok) return setFailed(true);
      const body = await res.json();
      setFailed(false);
      setItems((prev) => (before ? [...(prev ?? []), ...body.items] : body.items));
      setNext(body.next);
      if (body.actors) setActors(body.actors);
    },
    [query, ws.id],
  );

  useEffect(() => {
    if (!manager) return;
    setItems(null);
    void load();
  }, [load, manager]);

  const typeName = useCallback(
    (id: string, many: boolean) => {
      const e = ws.blueprint.entities.find((x) => x.id === id);
      return e ? (many ? e.pluralName : e.name).toLowerCase() : id;
    },
    [ws.blueprint],
  );
  const title = useCallback(
    (id: string) => {
      const record = ws.records.find((r) => r.id === id);
      const entity = record && ws.blueprint.entities.find((e) => e.id === record.entityId);
      return record && entity ? recordTitle(entity, record) : undefined;
    },
    [ws.records, ws.blueprint],
  );
  const pageName = (key: string) => ws.blueprint.views.find((v) => v.id === key.split(":")[0])?.name ?? key;

  if (!manager)
    return (
      <SettingsPage>
        <SettingsSection
          title="Activity"
          description="Only the workspace's owners and admins can see its activity log."
        />
      </SettingsPage>
    );

  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <SettingsPage>
      <SettingsSection
        title="Activity"
        description={`Every change to ${ws.name}, with who or what made it: people in the app, API keys, AI agents, automations and public forms. Refused requests from keys show too. Entries are kept for ${RETENTION_DAYS} days.`}
        footer={
          items ? `${items.length}${next ? "+" : ""} entr${items.length === 1 ? "y" : "ies"}` : undefined
        }
        action={
          <a
            className={buttonVariants({ variant: "outline" })}
            href={`/api/workspaces/${encodeURIComponent(ws.id)}/activity?${query}${query.size ? "&" : ""}format=csv`}
          >
            <DownloadSimpleIcon data-icon="inline-start" />
            Export CSV
          </a>
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor="activity-who" className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            Who
            <NativeSelect
              size="sm"
              value={filters.actor}
              onChange={set("actor")}
              aria-label="Who"
              id="activity-who"
            >
              <NativeSelectOption value="">Everyone</NativeSelectOption>
              {ACTOR_TYPES.map((t) => (
                <NativeSelectOptGroup key={t} label={ACTOR_LABELS[t]}>
                  <NativeSelectOption value={t}>Any {ACTOR_LABELS[t].toLowerCase()}</NativeSelectOption>
                  {actors
                    .filter((a) => a.type === t)
                    .map((a) => (
                      <NativeSelectOption key={a.id} value={`${t}:${a.id}`}>
                        {a.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
          </label>
          <label htmlFor="activity-what" className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            What
            <NativeSelect
              size="sm"
              value={filters.action}
              onChange={set("action")}
              aria-label="What"
              id="activity-what"
            >
              <NativeSelectOption value="">Anything</NativeSelectOption>
              {ACTION_GROUPS.map((a) => (
                <NativeSelectOption key={a.value} value={a.value}>
                  {a.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label htmlFor="activity-result" className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            Result
            <NativeSelect
              size="sm"
              value={filters.result}
              onChange={set("result")}
              aria-label="Result"
              id="activity-result"
            >
              <NativeSelectOption value="">Any</NativeSelectOption>
              <NativeSelectOption value="ok">Done</NativeSelectOption>
              <NativeSelectOption value="denied">Denied</NativeSelectOption>
              <NativeSelectOption value="conflict">Conflict</NativeSelectOption>
              <NativeSelectOption value="error">Failed</NativeSelectOption>
            </NativeSelect>
          </label>
          <label htmlFor="activity-from" className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            From
            <Input
              type="date"
              className="h-7 w-[150px] text-[13px]"
              id="activity-from"
              value={filters.from}
              onChange={set("from")}
            />
          </label>
          <label htmlFor="activity-to" className="flex flex-col gap-1 text-[12px] text-muted-foreground">
            To
            <Input
              type="date"
              className="h-7 w-[150px] text-[13px]"
              id="activity-to"
              value={filters.to}
              onChange={set("to")}
            />
          </label>
          {Object.values(filters).some(Boolean) ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
              Clear
            </Button>
          ) : null}
        </div>

        {failed ? (
          <p className="text-[13px] text-destructive">The activity log couldn't be loaded. Try again.</p>
        ) : items === null ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing matches these filters.</p>
        ) : (
          <ul className="-my-1 flex flex-col">
            {items.map((item) => {
              const Icon = ICONS[item.actorType] ?? UserIcon;
              const badge = RESULT_STYLE[item.result];
              const what =
                item.action === "page.update" && item.target
                  ? `Edited page ${pageName(item.target)}`
                  : describeActivity(item, typeName, title);
              return (
                <li key={item.id} className="flex items-start gap-3 border-b py-2.5 last:border-b-0">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                    <Icon className="size-3.5 text-muted-foreground" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                      <span className="font-medium">{item.actorName ?? ACTOR_LABELS[item.actorType]}</span>
                      <span className="text-foreground/85">{what}</span>
                      {badge ? (
                        <span className={cn("rounded-full border px-2 text-[11px] leading-5", badge.tone)}>
                          {badge.label}
                        </span>
                      ) : null}
                    </div>
                    <span className="truncate text-[12px] text-muted-foreground">
                      {[
                        formatDateTime(item.at),
                        ACTOR_LABELS[item.actorType],
                        item.count > 1 && item.action === "page.update" ? `${item.count} saves` : null,
                        item.action !== "api.denied" ? item.detail : null,
                        item.ip,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {next ? (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void load(next)}>
            <CaretDownIcon data-icon="inline-start" />
            Show older
          </Button>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  );
}
