"use client";

import { RobotIcon, SparkleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspaces";

type AgentRequest = { id: number; request: string; keyName: string | null; by: string; createdAt: string };

/**
 * Design changes AI agents asked for through MCP (propose_change, or an ask_everyops plan that has to wait for a person).
 * An owner or admin drafts the request with Ask EveryOps, which shows the plan for approval like any other.
 */
export function AgentRequests() {
  const ws = useWorkspace();
  const setDraft = useAssistant((s) => s.setDraft);
  const setOpen = useAssistant((s) => s.setOpen);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const allowed = ws.mode === "live" && canManage(ws.role);
  const url = `/api/workspaces/${encodeURIComponent(ws.id)}/agent-requests`;

  const load = useCallback(async () => {
    const res = await fetch(url).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; requests?: AgentRequest[] } | null;
    setRequests(body?.requests ?? []);
  }, [url]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const close = async (r: AgentRequest, status: "drafted" | "dismissed") => {
    setRequests((list) => list.filter((x) => x.id !== r.id));
    await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: r.id, status }),
    }).catch(() => {});
  };

  if (!allowed || !requests.length) return null;
  return (
    <section aria-label="Requests from AI agents" className="border-b px-5 py-4">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-medium">
        <RobotIcon className="size-4 text-muted-foreground" />
        Requests from AI agents
        <span className="font-normal text-muted-foreground">· nothing changes until you apply a plan</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <li key={r.id} className="flex items-start gap-3 rounded-lg border bg-muted/20 px-3.5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[13.5px]">“{r.request}”</p>
              <span className="text-[12px] text-muted-foreground">
                {r.keyName ? `${r.keyName} (${r.by}'s key)` : r.by} · {formatDateTime(r.createdAt)}
              </span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => void close(r, "dismissed")}>
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setDraft(r.request);
                  setOpen(true);
                  void close(r, "drafted");
                }}
              >
                <SparkleIcon data-icon="inline-start" />
                Draft with Ask EveryOps
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
