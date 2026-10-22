"use client";

import { CopyIcon, DownloadSimpleIcon, SignOutIcon, TrashIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { CATALOG } from "@/lib/catalog";
import { downloadText, fileSlug } from "@/lib/download";
import { CURRENCIES, currencyOf, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { SettingsPage, SettingsSection } from "./settings-section";

export function WorkspaceSettings() {
  const ws = useWorkspace();
  const router = useRouter();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  const rename = useWorkspaces((s) => s.renameWorkspace);
  const remove = useWorkspaces((s) => s.deleteWorkspace);
  const [name, setName] = useState(ws.name);
  if (!workspace) return null;
  const manager = canManage(ws.role);
  const owner = ws.role === "owner" && !ws.isShared;
  const changed = name.trim().length > 0 && name.trim() !== ws.name;

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    rename(ws.id, name);
    toast.success("Workspace renamed", { description: "You can undo it from History." });
  };
  const copyUrl = async () => {
    const url = `${window.location.origin}/w/${ws.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Workspace link copied");
    } catch {
      toast.info("Workspace link", { description: url });
    }
  };
  const download = (file: string, data: unknown) => downloadText(file, JSON.stringify(data, null, 2));
  // The latest change still in effect; version numbers stay out of the product.
  const lastChange = workspace.changes.find((c) => !c.undoneAt);
  const source = workspace.source && CATALOG.find((s) => s.id === workspace.source?.systemId);

  const details: [string, React.ReactNode][] = [
    ["Owner", workspace.owner?.name ?? "You"],
    ["Created", formatDate(workspace.createdAt, { withYear: true })],
    [
      "Last change",
      <Link key="v" href={`${ws.basePath}/history`} className="text-primary hover:underline">
        {lastChange ? `${formatDateTime(lastChange.appliedAt)}, see history` : "None yet, see history"}
      </Link>,
    ],
    ["Systems", formatNumber(ws.blueprint.systems.length)],
    ["Records", formatNumber(ws.records.length)],
    [
      "Based on",
      workspace.source ? (
        <Link key="s" href={`/preview/${workspace.source.systemId}`} className="hover:underline">
          {source ? source.name : "A community system"}
        </Link>
      ) : (
        "Built with Ask EveryOps"
      ),
    ],
  ];

  return (
    <SettingsPage>
      <form onSubmit={saveName}>
        <SettingsSection
          title="Workspace name"
          description="Shown in the sidebar, the workspace switcher and invites."
          footer={
            manager
              ? "Renames are versioned and can be undone from History."
              : "Only the owner or an admin can rename this workspace."
          }
          action={
            manager ? (
              // Outlined until there's something to save, so an unchanged name doesn't look ready to submit.
              <Button type="submit" size="sm" variant={changed ? "default" : "outline"} disabled={!changed}>
                Save
              </Button>
            ) : null
          }
        >
          <Input
            id="workspace-name"
            aria-label="Workspace name"
            className="h-9 max-w-[360px]"
            maxLength={60}
            value={name}
            readOnly={!manager}
            onChange={(e) => setName(e.target.value)}
          />
        </SettingsSection>
      </form>

      <CurrencySetting manager={manager} />

      <SettingsSection
        title="Workspace link"
        description="Anyone on the team can open the workspace from this address."
        action={
          <Button variant="outline" size="sm" onClick={copyUrl}>
            <CopyIcon data-icon="inline-start" />
            Copy link
          </Button>
        }
        footer="People need an account and an invite to get in."
      >
        <div className="flex h-9 max-w-[420px] items-center rounded-lg border bg-background/60 px-3 font-mono text-[12.5px] text-muted-foreground">
          <span className="truncate">/w/{ws.id}</span>
        </div>
      </SettingsSection>

      <SettingsSection title="Details" description="What this workspace is made of.">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-foreground/[0.07] sm:grid-cols-3">
          {details.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5 bg-background px-4 py-3">
              <dt className="text-[12px] text-muted-foreground">{label}</dt>
              <dd className="truncate text-[13.5px] font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>

      <SettingsSection
        title="Export"
        description="Your data is yours. The blueprint is the whole system design; records are the data inside it."
      >
        <div className="divide-y rounded-lg border">
          <ExportRow
            title="Blueprint"
            detail="Systems, fields, screens and rules, as they are now"
            onDownload={() =>
              download(`${fileSlug(ws.name)}-blueprint-v${workspace.currentVersion}.json`, ws.blueprint)
            }
          />
          <ExportRow
            title="Blueprint and records"
            detail={`Everything above plus ${formatNumber(ws.records.length)} records`}
            onDownload={() =>
              download(`${fileSlug(ws.name)}-records.json`, { blueprint: ws.blueprint, records: ws.records })
            }
          />
        </div>
      </SettingsSection>

      {owner ? (
        <SettingsSection
          title="Delete workspace"
          tone="danger"
          description="Removes this workspace, its records and its history for everyone on the team."
          footer="This can't be undone. Export first if you might need the data."
          action={
            <ConfirmDeleteDialog
              trigger={
                <Button variant="destructive" size="sm">
                  <TrashIcon data-icon="inline-start" />
                  Delete workspace
                </Button>
              }
              title={`Delete ${ws.name}?`}
              description="Every record and version in this workspace will be removed. Export first if you might need it."
              label={`Type ${ws.name} to confirm`}
              expected={ws.name}
              actionLabel="Delete workspace"
              onConfirm={() => {
                router.replace("/workspaces");
                remove(ws.id);
                toast.success(`${ws.name} deleted`);
                return undefined;
              }}
            />
          }
        />
      ) : (
        <SettingsSection
          title="Leave workspace"
          tone="danger"
          description="This workspace belongs to someone else, so you can't delete it. You can leave it instead."
          action={
            <Button
              variant="destructive"
              size="sm"
              render={<Link href={`${ws.basePath}/settings/team`} />}
              nativeButton={false}
            >
              <SignOutIcon data-icon="inline-start" />
              Leave from Team
            </Button>
          }
        />
      )}
    </SettingsPage>
  );
}

function ExportRow({ title, detail, onDownload }: { title: string; detail: string; onDownload: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="text-[12.5px] text-muted-foreground">{detail}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onDownload}>
        <DownloadSimpleIcon data-icon="inline-start" />
        Download JSON
      </Button>
    </div>
  );
}

/**
 * The currency the workspace's money reads in. Amounts don't change; ₱1,250 becomes S$1,250, so it's for setting
 * the right currency, not converting. Versioned like a rename, so History can undo it.
 */
function CurrencySetting({ manager }: { manager: boolean }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const current = currencyOf(ws.blueprint);
  const [picked, setPicked] = useState<string>(current);
  const changed = picked !== current;
  const name = (code: string) => CURRENCIES.find((c) => c.code === code)?.name ?? code;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    const entry = applyChange(ws.id, {
      request: `Show money in ${name(picked)}`,
      title: `Currency changed to ${picked}`,
      facts: [],
      steps: [{ kind: "change", label: "Currency", detail: `${current} → ${picked}` }],
      ops: [{ op: "set_currency", currency: picked }],
    });
    if (entry)
      toast.success(`Money now reads in ${name(picked)}`, { description: "You can undo it from History." });
    else toast.error("Couldn't change the currency");
  };

  return (
    <form onSubmit={save}>
      <SettingsSection
        title="Currency"
        description="How prices, totals and payments read across the workspace, its public pages, emails and prints."
        footer={
          manager
            ? "Amounts stay the same numbers; only their currency changes. Undo it from History."
            : "Only the owner or an admin can change the currency."
        }
        action={
          manager ? (
            <Button type="submit" size="sm" variant={changed ? "default" : "outline"} disabled={!changed}>
              Save
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect
            id="workspace-currency"
            aria-label="Currency"
            className="w-[280px]"
            value={picked}
            disabled={!manager}
            onChange={(e) => setPicked(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <NativeSelectOption key={c.code} value={c.code}>
                {c.name} ({c.code})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="font-mono text-[13px] text-muted-foreground tabular">
            {formatMoney(1250.5, { currency: picked })}
          </span>
        </div>
      </SettingsSection>
    </form>
  );
}
