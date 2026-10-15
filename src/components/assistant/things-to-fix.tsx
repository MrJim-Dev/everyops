"use client";

import { ArrowClockwiseIcon, CheckCircleIcon, WrenchIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Checkup, KIND_LABEL } from "@/lib/assistant/checkup";
import { cn } from "@/lib/utils";

const hiddenKey = (workspaceId: string) => `everyops.checkup-hidden.${workspaceId}`;

/**
 * What the assistant noticed when it compared the workspace with what it knows about the business. Fix sends the
 * finding's request as a message, so the workspace's permissions decide whether it waits for approval.
 */
export function ThingsToFix({
  workspaceId,
  workspaceName,
  onFix,
}: {
  workspaceId: string;
  workspaceName: string;
  onFix: (request: string) => void;
}) {
  const [checkup, setCheckup] = useState<Checkup | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [hidden, setHidden] = useState<string[]>([]);

  const load = useCallback(
    async (refresh = false) => {
      setState("loading");
      try {
        const res = await fetch(
          `/api/ai/checkup?workspaceId=${encodeURIComponent(workspaceId)}${refresh ? "&refresh=1" : ""}`,
        );
        const body = (await res.json()) as { ok: boolean; checkup?: Checkup };
        if (!body.ok || !body.checkup) throw new Error();
        setCheckup(body.checkup);
        setState("ready");
      } catch {
        setState("failed");
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    try {
      setHidden(JSON.parse(sessionStorage.getItem(hiddenKey(workspaceId)) ?? "[]"));
    } catch {}
    void load();
  }, [workspaceId, load]);

  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    sessionStorage.setItem(hiddenKey(workspaceId), JSON.stringify(next));
  };

  const findings = (checkup?.findings ?? []).filter((f) => !hidden.includes(f.id));

  return (
    <section aria-label="Things to fix" className="mt-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-primary" />
        <h3 className="flex-1 text-[13px] font-medium">Things to fix</h3>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Check again"
          disabled={state === "loading"}
          onClick={() => void load(true)}
        >
          <ArrowClockwiseIcon className={cn(state === "loading" && "animate-spin")} />
        </Button>
      </div>
      {state === "loading" && !checkup ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-muted-foreground">
            Checking {workspaceName} against what I know about the business…
          </p>
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : state === "failed" && !checkup ? (
        <p className="text-[12.5px] text-muted-foreground">Couldn't check the workspace right now.</p>
      ) : findings.length ? (
        <ul className="flex flex-col gap-2">
          {findings.map((f) => (
            <li key={f.id} className="rounded-lg border bg-card/40 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="mb-1 inline-block rounded border px-1.5 py-px text-[10.5px] text-muted-foreground">
                    {KIND_LABEL[f.kind]}
                  </span>
                  <p className="text-[13px] font-medium leading-snug">{f.title}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{f.detail}</p>
                  {f.evidence ? (
                    <p className="mt-1.5 border-l-2 border-primary/30 pl-2 text-[11.5px] leading-snug text-muted-foreground">
                      {f.evidence}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Hide "${f.title}"`}
                  onClick={() => hide(f.id)}
                >
                  <XIcon />
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2.5 h-auto w-full justify-start whitespace-normal py-1.5 text-left leading-snug"
                onClick={() => onFix(f.fix)}
              >
                <span>
                  <span className="font-medium text-primary">Fix</span> · {f.fix}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <CheckCircleIcon className="size-4 text-primary" />
          Everything matches what I know about {workspaceName}.
        </p>
      )}
    </section>
  );
}
