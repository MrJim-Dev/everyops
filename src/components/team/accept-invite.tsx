"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";
import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/auth/store";
import { useAuthReady } from "@/lib/auth/use-auth-ready";
import { findInvite, ROLES, useWorkspaces } from "@/lib/store/workspaces";

export function AcceptInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const ready = useAuthReady();
  const user = useCurrentUser();
  const byOwner = useWorkspaces((s) => s.byOwner);
  const hydrated = useWorkspaces((s) => s.owner !== undefined);
  const acceptInvite = useWorkspaces((s) => s.acceptInvite);
  const [error, setError] = useState<string>();

  if (!ready || !hydrated) return <Skeleton className="mx-auto mt-[20vh] h-48 w-full max-w-[360px]" />;

  const found = findInvite(byOwner, token);
  if (!found) {
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

  const { workspace, invite } = found;
  const role = ROLES.find((r) => r.id === invite.role);
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <AuthShell
      title={`Join ${workspace.name}`}
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
        {user ? (
          <>
            <Button
              className="h-10 w-full"
              onClick={() => {
                const result = acceptInvite(token, user);
                if (!result.ok) return setError(result.message);
                toast.success(`You joined ${workspace.name}`);
                router.replace(`/w/${result.key}`);
              }}
            >
              Join as {user.name}
            </Button>
            <p className="text-center text-[12.5px] text-muted-foreground">
              Signed in as {user.email}. Not you?{" "}
              <Link
                href={`/sign-in?next=${next}`}
                className="text-foreground underline-offset-4 hover:underline"
              >
                Use another account
              </Link>
            </p>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </AuthShell>
  );
}
