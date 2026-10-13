"use client";

import { ArrowSquareOutIcon, CheckIcon, ShieldCheckIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
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
import { CATEGORIES, type CatalogCategory } from "@/lib/catalog";
import { describeBlueprint, toCatalogSystem, usePublished } from "@/lib/community/published";
import { formatDate } from "@/lib/format";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";

const LICENSES = { MIT: "MIT", "Apache-2.0": "Apache 2.0" } as const;
const CATEGORY_ITEMS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** Guess a category from what the blueprint contains. */
function guessCategory(views: string[]): CatalogCategory {
  if (views.includes("checkout")) return "pos";
  if (views.includes("slot_grid")) return "booking";
  if (views.includes("approval_queue")) return "hris";
  if (views.includes("kanban")) return "social";
  return "finance";
}

export function PublishPage() {
  const ws = useWorkspace();
  const user = useCurrentUser();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  const home =
    useWorkspaces((s) => s.shared[ws.id]) ??
    (workspace?.ownerId ? { owner: workspace.ownerId, slug: ws.id } : null);
  const existing = usePublished((s) =>
    home ? s.systems.find((x) => x.source.owner === home.owner && x.source.slug === home.slug) : undefined,
  );
  const { publish, update, unpublish } = usePublished.getState();
  const [form, setForm] = useState(() => ({
    name: existing?.name ?? ws.name,
    summary: existing?.summary ?? "",
    category: existing?.category ?? guessCategory(ws.blueprint.views.map((v) => v.type)),
    license: existing?.license ?? ("MIT" as const),
  }));
  const [errors, setErrors] = useState<{ name?: string; summary?: string }>({});

  if (!workspace || !user || !home) return null;
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

  const includes = describeBlueprint(ws.blueprint);
  const preview = toCatalogSystem({
    id: existing?.id ?? "draft",
    ...form,
    name: form.name || ws.name,
    summary: form.summary || "Your summary appears here.",
    version: existing?.version ?? "1.0",
    authorId: user.id,
    authorName: user.name,
    source: home,
    blueprint: ws.blueprint,
    publishedAt: "",
    updatedAt: "",
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (form.name.trim().length < 3) next.name = "Use at least 3 characters";
    if (form.summary.trim().length < 20) next.summary = "Describe what it does in at least 20 characters";
    setErrors(next);
    if (Object.keys(next).length) return;
    const input = { ...form, name: form.name.trim(), summary: form.summary.trim() };
    if (existing) {
      const updated = update(existing.id, input, ws.blueprint);
      toast.success(`Published version ${updated?.version}`);
    } else {
      publish({ ...input, authorId: user.id, authorName: user.name, source: home, blueprint: ws.blueprint });
      toast.success(`${input.name} is live in Community`);
    }
  };

  return (
    <SettingsPage>
      <p className="mt-6 text-[13px] text-muted-foreground">
        Share this system's design in Community so other businesses can use it.
      </p>
      {existing ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/[0.06] px-4 py-3 text-[13px]">
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

      <div className="grid gap-10 pt-6 lg:grid-cols-[1fr_300px]">
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <FieldGroup className="gap-5">
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

          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold">
              <ShieldCheckIcon className="size-4 text-primary" />
              What gets published
            </h2>
            <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
              {includes.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckIcon className="size-3.5 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Only the design is shared: record types, fields, screens and rules. Your {ws.records.length}{" "}
              records, team and history stay private.
            </p>
          </section>

          <div className="flex gap-2">
            <Button type="submit">
              <UploadSimpleIcon data-icon="inline-start" />
              {existing ? `Publish version ${bumped(existing.version)}` : "Publish"}
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">Listing preview</span>
          <div className="pointer-events-none">
            <SystemCard system={preview} onSelect={() => {}} />
          </div>
        </aside>
      </div>

      {existing ? (
        <SettingsSection
          title="Unpublish"
          tone="danger"
          description="Removes the listing. Workspaces that already copied it keep their copy."
        >
          <div>
            <ConfirmDeleteDialog
              trigger={<Button variant="destructive">Unpublish</Button>}
              title={`Unpublish ${existing.name}?`}
              description="It will disappear from Community. You can publish it again later."
              label={`Type ${existing.name} to confirm`}
              expected={existing.name}
              actionLabel="Unpublish"
              onConfirm={() => {
                unpublish(existing.id);
                toast(`${existing.name} unpublished`);
                return undefined;
              }}
            />
          </div>
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}

function bumped(version: string) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${(minor || 0) + 1}`;
}
