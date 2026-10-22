"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export type WaitlistRow = {
  email: string;
  name: string | null;
  source: "email" | "google";
  status: "waiting" | "approved";
  createdAt: string;
  approvedAt: string | null;
};

/** The private-beta waitlist for site admins: who's waiting, newest first, with Approve. */
export function WaitlistTable({ entries }: { entries: WaitlistRow[] }) {
  const [rows, setRows] = useState(entries);
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = rows.filter((r) => r.status === "waiting").length;

  const approve = async (email: string) => {
    setBusy(email);
    const res = await fetch("/api/admin/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      emailed?: boolean;
      message?: string;
    } | null;
    setBusy(null);
    if (!body?.ok) return toast.error(body?.message ?? "Couldn't approve. Try again.");
    setRows((list) =>
      list.map((r) =>
        r.email === email ? { ...r, status: "approved", approvedAt: new Date().toISOString() } : r,
      ),
    );
    toast.success(`Approved ${email}`, {
      description: body.emailed
        ? "They've been emailed a link to create their account."
        : "Approved. The email didn't send; let them know they can sign up.",
    });
  };

  return (
    <section className="mt-10 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Waitlist</h1>
        <p className="text-[13.5px] text-muted-foreground">
          {waiting === 1 ? "1 person is" : `${waiting} people are`} waiting. Approving someone lets them
          create their account and emails them a sign-up link.
        </p>
      </header>
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tried with</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[150px] text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.email}>
                  <TableCell className="font-medium">{r.name ?? "—"}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.source === "google" ? "Google" : "Email"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "approved" ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckIcon />
                        Approved
                      </Badge>
                    ) : (
                      <Button size="sm" disabled={busy === r.email} onClick={() => void approve(r.email)}>
                        {busy === r.email ? "Approving…" : "Approve"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-[13.5px] text-muted-foreground">
          Nobody is on the waitlist yet.
        </p>
      )}
    </section>
  );
}
