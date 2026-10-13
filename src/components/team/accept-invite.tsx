"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthReady, useCurrentUser } from "@/lib/auth/client";
import { type MemberRole, ROLES, useWorkspaces } from "@/lib/store/workspaces";

type InviteInfo = {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
};

export function AcceptInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const ready = useAuthReady();
  const user = useCurrentUser();
  const [invite, setInvite] = useState<InviteInfo | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [joining, setJoining] = useState(false);
  const next = encodeURIComponent(`/invite/${token}`);

  useEffect(() => {
    if (!ready || !user) return;
    let alive = true;
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setInvite(body?.invite ?? null))
      .catch(() => alive && setInvite(null));
    return () => {
      alive = false;
    };
  }, [ready, user, token]);

  if (!ready) return <Skeleton className="mx-auto mt-[20vh] h-48 w-full max-w-[360px]" />;

  if (!user) {
    return (
      <AuthShell
        title="You've been invited"
        description="Sign in or create an account with the invited email to join."
      >
        <div className="flex flex-col gap-3">
          <Button
            className="h-10 w-full"
            render={<Link href={`/sign-up?next=${next}`} />}
            nativeButton={false}
          >
            Create an account to join
          </Button>
          <Button
            variant="outline"
            className="h-10 w-full"
            render={<Link href={`/sign-in?next=${next}`} />}
            nativeButton={false}
          >
            I already have an account
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (invite === undefined) return <Skeleton className="mx-auto mt-[20vh] h-48 w-full max-w-[360px]" />;
  if (!invite) {
    return (
      <AuthShell
        title="This invite isn't valid"
        description="It may have been used already or revoked. Ask the person who invited you for a new link."
        footer={<AuthLink href="/">Go to your workspaces</AuthLink>}
      >
        <span />
      </AuthShell>
    );
  }

  const role = ROLES.find((r) => r.id === invite.role);
  const join = async () => {
    setJoining(true);
    const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, { method: "POST" });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      workspaceId?: string;
      message?: string;
    } | null;
    if (!body?.ok || !body.workspaceId) {
      setJoining(false);
      return setError(body?.message ?? "Couldn't join. Try again.");
    }
    // Reload the workspace list so the shared workspace appears.
    await useWorkspaces.getState().load(null);
    await useWorkspaces.getState().load(user.id);
    toast.success(`You joined ${invite.workspaceName}`);
    router.replace(`/w/${body.workspaceId}`);
  };

  return (
    <AuthShell
      title={`Join ${invite.workspaceName}`}
      description={
        <>
          {invite.invitedBy} invited <span className="text-foreground">{invite.email}</span> to join as{" "}
          <span className="text-foreground">{role?.label}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card/40 p-4">
          <span className="flex size-10 animate-pop items-center justify-center rounded-full bg-primary/15 text-primary">
            <UsersThreeIcon className="size-5" />
          </span>
          <div className="text-[13px]">
            <p className="font-medium">{role?.label}</p>
            <p className="text-muted-foreground">{role?.description}</p>
          </div>
        </div>
        {error ? <FormAlert key={error} message={error} /> : null}
        <Button className="h-10 w-full" disabled={joining} onClick={join}>
          {joining ? "Joining…" : `Join as ${user.name}`}
        </Button>
        <p className="text-center text-[12.5px] text-muted-foreground">
          Signed in as {user.email}. Not you?{" "}
          <Link href={`/sign-in?next=${next}`} className="text-foreground underline-offset-4 hover:underline">
            Use another account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
