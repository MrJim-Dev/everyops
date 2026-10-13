"use client";

import { DownloadSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { downloadText, fileSlug } from "@/lib/download";
import { formatDate } from "@/lib/format";
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

  const counts = ws.blueprint.entities.map((e) => ({
    label: e.pluralName,
    count: ws.records.filter((r) => r.entityId === e.id).length,
  }));
  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || name.trim() === ws.name) return;
    rename(ws.id, name);
    toast.success("Workspace renamed", { description: "You can undo it from History." });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title="Settings" description={`Manage ${ws.name}.`} className="border-b pb-3" />
      <SettingsPage>
        <SettingsSection title="General" description="How this workspace appears to you and your team.">
          <form onSubmit={saveName} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="workspace-name"
                  className="h-9"
                  value={name}
                  readOnly={!manager}
                  onChange={(e) => setName(e.target.value)}
                />
                {manager ? (
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-9"
                    disabled={!name.trim() || name.trim() === ws.name}
                  >
                    Save
                  </Button>
                ) : null}
              </div>
              <FieldDescription>
                {manager
                  ? "Renames are versioned like any other change."
                  : "Only the owner or an admin can rename this workspace."}
              </FieldDescription>
            </Field>
          </form>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatDate(workspace.createdAt, { withYear: true })}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="tabular">
                v{workspace.currentVersion} ·{" "}
                <Link href={`${ws.basePath}/history`} className="text-primary hover:underline">
                  History
                </Link>
              </dd>
            </div>
            {workspace.source ? (
              <div>
                <dt className="text-muted-foreground">Based on</dt>
                <dd>
                  <Link href={`/preview/${workspace.source.systemId}`} className="hover:underline">
                    Community system v{workspace.source.version}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </SettingsSection>

        <SettingsSection
          title="Export"
          description="Your data is yours. The blueprint is the whole system design; records are the data inside it."
        >
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
            {counts.map((c) => (
              <li key={c.label} className="tabular">
                {c.count} {c.label.toLowerCase()}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  `${fileSlug(ws.name)}-blueprint-v${workspace.currentVersion}.json`,
                  JSON.stringify(ws.blueprint, null, 2),
                )
              }
            >
              <DownloadSimpleIcon data-icon="inline-start" />
              Blueprint (JSON)
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  `${fileSlug(ws.name)}-records.json`,
                  JSON.stringify({ blueprint: ws.blueprint, records: ws.records }, null, 2),
                )
              }
            >
              <DownloadSimpleIcon data-icon="inline-start" />
              Blueprint and records
            </Button>
          </div>
        </SettingsSection>

        {owner ? (
          <SettingsSection
            title="Delete workspace"
            tone="danger"
            description="Removes this workspace, its records and its history. This can't be undone."
          >
            <div>
              <ConfirmDeleteDialog
                trigger={
                  <Button variant="destructive">
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
                  router.replace("/");
                  remove(ws.id);
                  toast(`${ws.name} deleted`);
                  return undefined;
                }}
              />
            </div>
          </SettingsSection>
        ) : (
          <SettingsSection
            title="Leave workspace"
            description="This workspace belongs to someone else, so you can't delete it."
          >
            <p className="text-[13px] text-muted-foreground">
              To stop seeing it, leave from the{" "}
              <Link href={`${ws.basePath}/team`} className="text-primary hover:underline">
                Team page
              </Link>
              .
            </p>
          </SettingsSection>
        )}
      </SettingsPage>
    </div>
  );
}
