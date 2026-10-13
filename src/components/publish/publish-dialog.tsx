"use client";

import { GlobeHemisphereWestIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { CATEGORIES, type CatalogCategory } from "@/lib/catalog";
import { describeBlueprint, type PublishedSystem, usePublished } from "@/lib/community/published";
import { blueprintOf, type Workspace } from "@/lib/store/workspace-model";
import {
  CATEGORY_ITEMS,
  guessCategory,
  LICENSES,
  nextVersion,
  type PublishErrors,
  validatePublish,
} from "./publish-shared";

/** Make a workspace public in Community, or publish a new version of its listing. */
export function PublishDialog({
  workspace,
  listing,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  listing?: PublishedSystem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const blueprint = blueprintOf(workspace);
  const [form, setForm] = useState(() => ({
    name: listing?.name ?? workspace.name,
    summary: listing?.summary ?? "",
    category: listing?.category ?? guessCategory(blueprint),
    license: listing?.license ?? ("MIT" as const),
  }));
  const [errors, setErrors] = useState<PublishErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const includes = describeBlueprint(blueprint);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = { ...form, name: form.name.trim(), summary: form.summary.trim() };
    const next = validatePublish(input);
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setFailure(undefined);
    const { publish, update } = usePublished.getState();
    const result = listing
      ? await update(listing.id, workspace.slug, input, blueprint)
      : await publish(workspace.slug, input, blueprint);
    setSaving(false);
    if (typeof result === "string") {
      setFailure(result);
      return;
    }
    onOpenChange(false);
    toast.success(listing ? `Published version ${result.version}` : `${input.name} is public in Community`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{listing ? `Update ${listing.name}` : `Make ${workspace.name} public`}</DialogTitle>
            <DialogDescription>
              {listing
                ? `Publishes this workspace's current design as version ${nextVersion(listing.version)}.`
                : "Other businesses can preview it and copy it into their own workspace."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="pd-name">Listing name</FieldLabel>
              <Input
                id="pd-name"
                autoFocus
                aria-invalid={errors.name ? true : undefined}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {errors.name ? <FieldError>{errors.name}</FieldError> : null}
            </Field>
            <Field data-invalid={errors.summary ? true : undefined}>
              <FieldLabel htmlFor="pd-summary">What it does</FieldLabel>
              <Textarea
                id="pd-summary"
                rows={3}
                placeholder="e.g. Takes pasabuy requests, assigns shoppers and tracks balances."
                aria-invalid={errors.summary ? true : undefined}
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              />
              {errors.summary ? <FieldError>{errors.summary}</FieldError> : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pd-category">Category</FieldLabel>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v as CatalogCategory }))}
                  items={CATEGORY_ITEMS}
                >
                  <SelectTrigger id="pd-category" className="w-full">
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
                <FieldLabel htmlFor="pd-license">License</FieldLabel>
                <Select
                  value={form.license}
                  onValueChange={(v) => setForm((f) => ({ ...f, license: v as keyof typeof LICENSES }))}
                  items={LICENSES}
                >
                  <SelectTrigger id="pd-license" className="w-full">
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
              </Field>
            </div>
          </FieldGroup>
          <div className="grid gap-3 rounded-xl border bg-muted/40 p-3.5 text-[12.5px] sm:grid-cols-2">
            <div className="flex gap-2.5">
              <GlobeHemisphereWestIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>
                <span className="font-medium">Shared:</span>{" "}
                <span className="text-muted-foreground">
                  {includes.join(", ").toLowerCase() || "the design"}
                </span>
              </p>
            </div>
            <div className="flex gap-2.5">
              <LockSimpleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p>
                <span className="font-medium">Private:</span>{" "}
                <span className="text-muted-foreground">
                  your {workspace.records.length} records, team and history
                </span>
              </p>
            </div>
          </div>
          {failure ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-[12.5px] text-destructive"
            >
              {failure}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <GlobeHemisphereWestIcon data-icon="inline-start" />
              {saving ? "Publishing…" : listing ? "Publish update" : "Make public"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
