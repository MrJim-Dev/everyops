"use client";

import { BellIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useScreen } from "@/lib/assistant/screen-store";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RailTip } from "./rail-tip";
import { RAIL_ITEM, RAIL_LABEL, railWidth } from "./sidebar-link";

type Item = {
  id: number;
  title: string;
  body: string | null;
  recordId: string | null;
  ruleName: string | null;
  createdAt: string;
  read: boolean;
};

/**
 * The bell beside Search: what automations told this person (a new booking for the owner, a job for staff),
 * newest first. Checked when the workspace opens, on focus and every 30 seconds; a notification opens its record.
 */
export function NotificationsButton({ rail }: { rail: boolean }) {
  const ws = useWorkspace();
  const openRecord = useScreen((s) => s.openRecord);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const url = `/api/workspaces/${encodeURIComponent(ws.id)}/notifications`;

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: "no-store" }).catch(() => null);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as { items: Item[]; unread: number } | null)
      : null;
    if (!body) return;
    setItems(body.items);
    setUnread(body.unread);
  }, [url]);

  useEffect(() => {
    void load();
    const tick = () => document.visibilityState === "visible" && void load();
    const timer = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [load]);

  const markRead = (ids?: number[]) => {
    setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnread((n) =>
      ids ? Math.max(0, n - ids.filter((id) => items.some((i) => i.id === id && !i.read)).length) : 0,
    );
    void fetch(url, { method: "POST", body: JSON.stringify(ids ? { ids } : {}) });
  };

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <RailTip rail={rail} label="Notifications">
        <PopoverTrigger
          aria-label={label}
          className={cn(
            "flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            RAIL_ITEM,
            railWidth(rail),
          )}
        >
          <span className="relative flex shrink-0">
            <BellIcon className="size-4 text-muted-foreground" />
            {unread && rail ? (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
            ) : null}
          </span>
          <span className={cn("flex-1 text-left", RAIL_LABEL)}>Notifications</span>
          {unread ? (
            <span
              className={cn(
                "min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-medium text-primary-foreground tabular",
                RAIL_LABEL,
              )}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </PopoverTrigger>
      </RailTip>
      <PopoverContent side="right" align="start" className="w-[360px] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-[13.5px] font-medium">Notifications</span>
          {unread ? (
            <button
              type="button"
              onClick={() => markRead()}
              className="text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {items.length ? (
          <ul className="flex max-h-[420px] flex-col overflow-y-auto py-1">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!n.read) markRead([n.id]);
                    if (n.recordId) {
                      openRecord(n.recordId);
                      setOpen(false);
                    }
                  }}
                  className="flex w-full gap-3 px-4 py-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn("text-[13px]", n.read ? "text-foreground/80" : "font-medium")}>
                      {n.title}
                    </span>
                    {n.body ? (
                      <span className="line-clamp-3 text-[12.5px] whitespace-pre-line text-muted-foreground">
                        {n.body}
                      </span>
                    ) : null}
                    <span className="text-[11.5px] text-muted-foreground">
                      {formatDateTime(n.createdAt)}
                      {n.ruleName ? ` · ${n.ruleName}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            Nothing yet. Ask EveryOps to notify you when something happens, like a new booking.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
