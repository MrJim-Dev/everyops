"use client";

import { ArrowSquareOutIcon, CheckIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SystemCard } from "@/components/community/system-card";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewEmpty } from "@/components/views/view-empty";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useCurrentUser } from "@/lib/auth/client";
import { DEMO_LOCKED_MESSAGE, isDemoEmail } from "@/lib/auth/demo";
import { CATEGORIES, type CatalogCategory } from "@/lib/catalog";
import { describeBlueprint, toCatalogSystem, usePublished } from "@/lib/community/published";
import { formatDate } from "@/lib/format";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";
import { CATEGORY_ITEMS, guessCategory, LICENSES, nextVersion } from "./publish-shared";

export function PublishPage() {
  const ws = useWorkspace();
  const user = useCurrentUser();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  const existing = usePublished((s) => s.systems.find((x) => x.sourceWorkspaceId === ws.id));
  const loadCommunity = usePublished((s) => s.load);
  useEffect(() => {
    void loadCommunity();
  }, [loadCommunity]);
  const { publish, update, unpublish } = usePublished.getState();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    name: existing?.name ?? ws.name,
    summary: existing?.summary ?? "",
    category: existing?.category ?? guessCategory(ws.blueprint),
    license: existing?.license ?? ("MIT" as const),
  }));
  const [errors, setErrors] = useState<{ name?: string; summary?: string }>({});

  if (!workspace || !user) return null;
  if (!canManage(ws.role)) {
    return (
      <ViewEmpty
        title="Only admins can publish"
        description="Ask the workspace owner or an admin to publish this system."
      />
    );
  }
  if (!ws.blueprint.systems.length) {
    return (
      <ViewEmpty
        title="Nothing to publish yet"
        description="Finish setting up this workspace with Ask EveryOps first."
      />
    );
  }

  if (isDemoEmail(user.email)) {
    return (
      <SettingsPage>
        <SettingsSection title="Publish to Community" description={DEMO_LOCKED_MESSAGE} />
      </SettingsPage>
    );
  }

  const includes = describeBlueprint(ws.blueprint);
  const preview = toCatalogSystem({
    id: existing?.id ?? "draft",
    official: false,
    ...form,
    name: form.name || ws.name,
    summary: form.summary || "Your summary appears here.",
    icon: existing?.icon ?? "chart",
    author: user.name,
    uses: existing?.uses ?? 0,
    includes,
    version: existing?.version ?? "1.0",
    authorId: user.id,
    sourceWorkspaceId: ws.id,
    blueprint: ws.blueprint,
    publishedAt: "",
    updatedAt: "",
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (form.name.trim().length < 3) next.name = "Use at least 3 characters";
    if (form.summary.trim().length < 20) next.summary = "Describe what it does in at least 20 characters";
    setErrors(next);
    if (Object.keys(next).length) return;
    const input = { ...form, name: form.name.trim(), summary: form.summary.trim() };
    setSaving(true);
    const result = existing
      ? await update(existing.id, ws.id, input, ws.blueprint)
      : await publish(ws.id, input, ws.blueprint);
    setSaving(false);
    if (typeof result === "string") return void toast.error("Couldn't publish", { description: result });
    toast.success(existing ? `Published version ${result.version}` : `${input.name} is live in Community`);
  };

  return (
    <SettingsPage>
      {existing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/[0.06] px-4 py-3 text-[13px]">
          <CheckIcon className="size-4 text-primary" />
          <span className="flex-1">
            Published as <span className="font-medium">{existing.name}</span> · v{existing.version} · updated{" "}
            {formatDate(existing.updatedAt, { withYear: true })}
          </span>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/preview/${existing.id}`} />}
            nativeButton={false}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            View listing
          </Button>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate>
        <SettingsSection
          title={existing ? "Listing" : "Publish to Community"}
          description="Share this system's design so other businesses can preview it and copy it into their own workspace."
          footer={`Only the design is shared. Your ${ws.records.length} records, team and history stay private.`}
          action={
            <Button type="submit" size="sm" disabled={saving}>
              <UploadSimpleIcon data-icon="inline-start" />
              {saving
                ? "Publishing…"
                : existing
                  ? `Publish version ${nextVersion(existing.version)}`
                  : "Publish"}
            </Button>
          }
        >
          <FieldGroup className="max-w-[520px] gap-5">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="pub-name">Name</FieldLabel>
              <Input
                id="pub-name"
                className="h-9"
                aria-invalid={errors.name ? true : undefined}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {errors.name ? (
                <FieldError>{errors.name}</FieldError>
              ) : (
                <FieldDescription>Name the system, not your business.</FieldDescription>
              )}
            </Field>
            <Field data-invalid={errors.summary ? true : undefined}>
              <FieldLabel htmlFor="pub-summary">What it does</FieldLabel>
              <Textarea
                id="pub-summary"
                rows={3}
                placeholder="e.g. Takes court bookings, blocks double-booking and tracks who still owes payment."
                aria-invalid={errors.summary ? true : undefined}
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              />
              {errors.summary ? <FieldError>{errors.summary}</FieldError> : null}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pub-category">Category</FieldLabel>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v as CatalogCategory }))}
                  items={CATEGORY_ITEMS}
                >
                  <SelectTrigger id="pub-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="pub-license">License</FieldLabel>
                <Select
                  value={form.license}
                  onValueChange={(v) => setForm((f) => ({ ...f, license: v as keyof typeof LICENSES }))}
                  items={LICENSES}
                >
                  <SelectTrigger id="pub-license" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(LICENSES).map(([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Lets others copy and adapt it.</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </SettingsSection>
      </form>

      <SettingsSection
        title="What gets published"
        description="Record types, fields, screens and rules. The preview shows how the listing looks in Community."
      >
        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <ul className="grid content-start gap-2 text-[13px] sm:grid-cols-2">
            {includes.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
          <div className="pointer-events-none" aria-hidden="true">
            <SystemCard system={preview} onSelect={() => {}} />
          </div>
        </div>
      </SettingsSection>

      {existing ? (
        <SettingsSection
          title="Unpublish"
          tone="danger"
          description="Removes the listing from Community."
          footer="Workspaces that already copied it keep their copy."
          action={
            <ConfirmDeleteDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Unpublish
                </Button>
              }
              title={`Unpublish ${existing.name}?`}
              description="It will disappear from Community. You can publish it again later."
              label={`Type ${existing.name} to confirm`}
              expected={existing.name}
              actionLabel="Unpublish"
              onConfirm={async () => {
                if (!(await unpublish(existing.id))) return "Couldn't unpublish. Try again.";
                toast.success(`${existing.name} unpublished`);
                return undefined;
              }}
            />
          }
        />
      ) : null}
    </SettingsPage>
  );
}
