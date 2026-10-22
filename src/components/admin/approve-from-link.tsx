"use client";

import { CheckCircleIcon, HourglassIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import type { WaitlistRow } from "./waitlist-table";

/** The confirm screen behind the approve link in the site admins' email. */
export function ApproveFromLink({ token, entry }: { token: string; entry: WaitlistRow }) {
  const [state, setState] = useState<"idle" | "busy" | "done">(entry.status === "approved" ? "done" : "idle");
  const [emailed, setEmailed] = useState<boolean | null>(null);
  const [error, setError] = useState<string>();
  const who = entry.name ?? entry.email;

  const approve = async () => {
    setState("busy");
    setError(undefined);
    const res = await fetch("/api/admin/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      emailed?: boolean;
      message?: string;
    } | null;
    if (!body?.ok) {
      setState("idle");
      return setError(body?.message ?? "Couldn't approve. Try again.");
    }
    setEmailed(!!body.emailed);
    setState("done");
  };

  if (state === "done")
    return (
      <AuthShell
        title={`${who} is approved`}
        description={
          emailed === false
            ? `They can create their account with ${entry.email} now. The email didn't send, so let them know.`
            : emailed
              ? `We emailed ${entry.email} a link to create their account.`
              : `${entry.email} was already approved and can create their account.`
        }
        footer={<AuthLink href="/admin/waitlist">Open the waitlist</AuthLink>}
      >
        <div className="flex items-center gap-3 rounded-lg border bg-card/40 p-4 text-[13px]">
          <CheckCircleIcon weight="fill" className="size-6 shrink-0 text-primary" />
          <span>Off the waitlist. Signing up with this email or Google now works.</span>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      title={`Approve ${who}?`}
      description="They'll be able to create their EveryOps account, and we'll email them a link to do it."
      footer={<AuthLink href="/admin/waitlist">Open the waitlist</AuthLink>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card/40 p-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
            <HourglassIcon className="size-5" />
          </span>
          <div className="min-w-0 text-[13px]">
            <p className="truncate font-medium">{entry.name ?? "No name given"}</p>
            <p className="truncate text-muted-foreground">
              {entry.email} · tried with {entry.source === "google" ? "Google" : "email"}
            </p>
          </div>
        </div>
        {error ? <FormAlert key={error} message={error} /> : null}
        <Button className="h-10 w-full" disabled={state === "busy"} onClick={() => void approve()}>
          {state === "busy" ? "Approving…" : `Approve ${who}`}
        </Button>
      </div>
    </AuthShell>
  );
}
