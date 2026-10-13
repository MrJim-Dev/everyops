"use client";

import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  GlobeHemisphereWestIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PublishDialog } from "@/components/publish/publish-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/lib/auth/client";
import { isDemoEmail } from "@/lib/auth/demo";
import { usePublished } from "@/lib/community/published";
import { blueprintOf, canManage, roleOf } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";

/**
 * Private or public in Community, set right from the workspace list. Owners and admins can change it;
 * everyone else just sees the state.
 */
export function WorkspaceVisibility({ slug, compact }: { slug: string; compact?: boolean }) {
  const router = useRouter();
  const user = useCurrentUser();
  const workspace = useWorkspaces((s) => s.workspaces[slug]);
  const listing = usePublished((s) => s.systems.find((x) => x.sourceWorkspaceId === slug));
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;

  const manage = canManage(roleOf(workspace, user?.id));
  const ready = blueprintOf(workspace)?.systems.length > 0 && !workspace.setup;

  if (!manage) return listing ? <PublicPill /> : null;
  // The shared demo account can't publish (the server refuses it), so don't offer it.
  if (user && isDemoEmail(user.email)) return listing ? <PublicPill /> : null;
  if (!ready)
    return compact ? null : <span className="text-[12px] text-muted-foreground">Finish setup to share</span>;

  const makePrivate = async () => {
    if (!listing) return;
    setBusy(true);
    const ok = await usePublished.getState().unpublish(listing.id);
    setBusy(false);
    setConfirmOpen(false);
    if (ok) toast.success(`${workspace.name} is private again`);
    else toast.error("Couldn't make it private. Try again.");
  };

  return (
    <>
      {listing ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${workspace.name} is public. Change visibility`}
            className="animate-pop inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-[12px] font-medium text-primary outline-none transition-[background-color,border-color] duration-150 hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-primary/15"
          >
            <GlobeHemisphereWestIcon className="size-3.5" />
            Public
            <CaretDownIcon className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push(`/community?system=${listing.id}`)}>
                <ArrowSquareOutIcon />
                View in Community
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPublishOpen(true)}>
                <PencilSimpleIcon />
                Publish an update
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setConfirmOpen(true)}>
                <LockSimpleIcon />
                Make private
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant={compact ? "ghost" : "outline"}
          size="sm"
          className={
            compact
              ? "h-7 rounded-full px-2.5 text-[12px] font-normal text-muted-foreground hover:text-foreground"
              : "h-7 rounded-full px-2.5 text-[12px]"
          }
          onClick={() => setPublishOpen(true)}
        >
          {compact ? (
            <GlobeHemisphereWestIcon data-icon="inline-start" />
          ) : (
            <LockSimpleIcon data-icon="inline-start" />
          )}
          {compact ? "Make public" : "Private"}
          {compact ? null : <span className="text-muted-foreground">· Make public</span>}
        </Button>
      )}
      {publishOpen ? (
        <PublishDialog
          workspace={workspace}
          listing={listing}
          open={publishOpen}
          onOpenChange={setPublishOpen}
        />
      ) : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make {workspace.name} private?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from Community. Workspaces that already copied it keep their copy, and you can
              make it public again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={makePrivate} disabled={busy}>
              {busy ? "Making private…" : "Make private"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PublicPill() {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-[12px] font-medium text-primary">
      <GlobeHemisphereWestIcon className="size-3.5" />
      Public
    </span>
  );
}
