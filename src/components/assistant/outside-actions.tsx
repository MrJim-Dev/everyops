"use client";

import { CalendarBlankIcon, CheckIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { type OutsideAction, PROVIDERS } from "@/lib/connections";
import { cn } from "@/lib/utils";

/**
 * Outside changes Ask EveryOps proposed (a calendar event, an email draft): nothing has run. Apply runs one now
 * through the connected service; Dismiss drops it.
 */
export function OutsideActions({ actions }: { actions: OutsideAction[] }) {
  const workspaceId = useWorkspace().id;
  const [state, setState] = useState<
    Record<number, { status: OutsideAction["status"] | "busy"; result?: string | null }>
  >({});
  const decide = async (a: OutsideAction, decision: "apply" | "dismiss") => {
    setState((s) => ({ ...s, [a.id]: { status: "busy" } }));
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/connections/actions/${a.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    const body = (await res.json().catch(() => null)) as { action?: OutsideAction; message?: string } | null;
    setState((s) => ({
      ...s,
      [a.id]: body?.action
        ? { status: body.action.status, result: body.action.result }
        : { status: "failed", result: body?.message ?? "That didn't work." },
    }));
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      {actions.map((a) => {
        const s = state[a.id] ?? { status: a.status };
        const Icon = a.provider === "gmail" ? EnvelopeSimpleIcon : CalendarBlankIcon;
        return (
          <div key={a.id} className="flex flex-col gap-2 rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-medium">{a.summary}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {PROVIDERS[a.provider]?.name} · {a.tool.replaceAll("_", " ")} · waits for your approval
                </span>
              </div>
            </div>
            {s.status === "proposed" || s.status === "busy" ? (
              <div className="flex gap-1.5">
                <Button size="sm" disabled={s.status === "busy"} onClick={() => void decide(a, "apply")}>
                  <CheckIcon data-icon="inline-start" />
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={s.status === "busy"}
                  onClick={() => void decide(a, "dismiss")}
                >
                  Dismiss
                </Button>
              </div>
            ) : (
              <span
                className={cn(
                  "text-[12px]",
                  s.status === "applied"
                    ? "text-success"
                    : s.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {s.status === "applied"
                  ? `Done in ${PROVIDERS[a.provider]?.name ?? "the service"}`
                  : s.status === "dismissed"
                    ? "Dismissed"
                    : `Didn't run: ${s.result ?? "unknown error"}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
