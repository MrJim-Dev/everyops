"use client";

import { CopyIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/lib/auth/client";
import { useCatalogSystem } from "@/lib/community/use-catalog";
import { useWorkspaces } from "@/lib/store/workspaces";

/**
 * Copies a community system into a workspace. Only the blueprint is copied;
 * sample records are optional and clearly labelled.
 */
export function UseSystemDialog({
  systemId,
  trigger,
  replaceSlug,
}: {
  systemId: string;
  trigger: ReactElement;
  /** Fill a workspace that is still being set up instead of creating a new one. */
  replaceSlug?: string;
}) {
  const system = useCatalogSystem(systemId);
  const router = useRouter();
  const createWorkspace = useWorkspaces((s) => s.createWorkspace);
  const finishSetup = useWorkspaces((s) => s.finishSetup);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [withSample, setWithSample] = useState(true);
  if (!system) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const finalName = name.trim() || system.name;
    const sample = system.sample(new Date(), finalName);
    const data = withSample ? sample : { blueprint: sample.blueprint, records: [] };
    const summary = system.includes.slice(0, 2).join(" and ");
    let slug = replaceSlug;
    if (replaceSlug) finishSetup(replaceSlug, data, finalName, summary);
    else
      slug = createWorkspace({
        name: finalName,
        summary,
        data,
        source: { systemId: system.id, version: system.version },
      });
    setOpen(false);
    const first = data.blueprint.systems[0];
    router.push(`/w/${slug}${first ? `/${first.id}` : ""}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Use {system.name}</DialogTitle>
            <DialogDescription>
              Creates your own copy. You can change it in your own words, and your business data stays
              private.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="use-name">Workspace name</FieldLabel>
              <Input
                id="use-name"
                autoFocus
                placeholder={system.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {system.authorId ? null : (
              <Field orientation="horizontal">
                <Checkbox
                  id="use-sample"
                  checked={withSample}
                  onCheckedChange={(c) => setWithSample(c === true)}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="use-sample">Start with sample data</FieldLabel>
                  <FieldDescription>Useful for trying it out. Delete it any time.</FieldDescription>
                </div>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <CopyIcon data-icon="inline-start" />
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Signed-out visitors are sent to create an account first, then come back to this system. */
export function UseSystemButton({ systemId, className }: { systemId: string; className?: string }) {
  const user = useCurrentUser();
  const pathname = usePathname();
  if (!user) {
    return (
      <Button
        className={className ?? "w-full"}
        render={<Link href={`/sign-up?next=${encodeURIComponent(pathname)}`} />}
        nativeButton={false}
      >
        Use in my workspace
      </Button>
    );
  }
  return (
    <UseSystemDialog
      systemId={systemId}
      trigger={<Button className={className ?? "w-full"}>Use in my workspace</Button>}
    />
  );
}
