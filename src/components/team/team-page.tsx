"use client";

import {
  CopyIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  SignOutIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNowStrict } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/records/person-chip";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useCurrentUser } from "@/lib/auth/client";
import { emailSchema } from "@/lib/auth/schemas";
import { formatDate } from "@/lib/format";
import { canManage, type Member, ROLES, useWorkspaces } from "@/lib/store/workspaces";
import { RoleSelect } from "./role-select";

const ROLE_LABEL = { owner: "Owner", ...Object.fromEntries(ROLES.map((r) => [r.id, r.label])) } as Record<
  string,
  string
>;

function inviteUrl(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast(message.replace("copied", "ready"), { description: text });
  }
}

export function TeamPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const user = useCurrentUser();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  const { inviteMember, revokeInvite, setMemberRole, removeMember, leaveWorkspace } =
    useWorkspaces.getState();
  const ownerAccount = useWorkspaces((s) => (workspace?.ownerId ? s.profiles[workspace.ownerId] : undefined));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("staff");
  const [error, setError] = useState<string>();
  if (!workspace || !user) return null;

  const manager = canManage(ws.role);
  const members = workspace.members ?? [];
  const invites = workspace.invites ?? [];

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    const address = parsed.data.toLowerCase();
    if (address === ownerAccount?.email || members.some((m) => m.email === address))
      return setError("This person is already on the team");
    const created = inviteMember(ws.id, address, role, user.name);
    if (!created) return;
    setEmail("");
    setError(undefined);
    void copy(inviteUrl(created.token), `Invite link for ${address} copied`);
  };

  const people = [
    {
      accountId: workspace.ownerId ?? "",
      name: ownerAccount?.name ?? "Workspace owner",
      email: ownerAccount?.email ?? "",
      role: "owner" as const,
      joinedAt: workspace.createdAt,
    },
    ...members,
  ];

  return (
    <SettingsPage>
      {manager ? (
        <SettingsSection
          title="Invite people"
          description="They'll get a link to join. Invites are tied to the email you enter."
        >
          <form onSubmit={invite} noValidate className="flex flex-col gap-2">
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="invite-email" className="sr-only">
                Email
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="name@business.com"
                  className="h-9 min-w-[200px] flex-1"
                  aria-invalid={error ? true : undefined}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(undefined);
                  }}
                />
                <RoleSelect
                  value={role}
                  onChange={setRole}
                  label="Role for this invite"
                  className="h-9 w-[120px]"
                />
                <Button type="submit" className="h-9">
                  <EnvelopeSimpleIcon data-icon="inline-start" />
                  Invite
                </Button>
              </div>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </form>
          <ul className="grid gap-1.5 text-[12.5px] text-muted-foreground sm:grid-cols-3">
            {ROLES.map((r) => (
              <li key={r.id}>
                <span className="font-medium text-foreground">{r.label}</span> · {r.description}
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Members"
        description={`${people.length} ${people.length === 1 ? "person has" : "people have"} access.${manager ? " Change roles or remove access at any time." : ""}`}
      >
        <ul className="divide-y rounded-lg border">
          {people.map((person, i) => {
            const isMe = person.accountId === user.id;
            const editable = manager && person.role !== "owner" && !isMe;
            return (
              <li
                key={person.accountId || person.email}
                className="flex animate-rise stagger items-center gap-3 px-4 py-3"
                style={{ "--i": i } as React.CSSProperties}
              >
                <PersonAvatar name={person.name} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">
                    {person.name}
                    {isMe ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                  </p>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    {person.email}
                    {person.role !== "owner" ? ` · joined ${formatDate(person.joinedAt)}` : null}
                  </p>
                </div>
                {editable ? (
                  <>
                    <RoleSelect
                      value={person.role as Member["role"]}
                      label={`Role for ${person.name}`}
                      onChange={(next) => {
                        setMemberRole(ws.id, person.accountId, next);
                        toast.success(`${person.name} is now ${ROLE_LABEL[next].toLowerCase()}`);
                      }}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label={`More for ${person.name}`} />
                        }
                      >
                        <DotsThreeIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              removeMember(ws.id, person.accountId);
                              toast(`${person.name} removed`);
                            }}
                          >
                            <UserMinusIcon />
                            Remove from workspace
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : (
                  <Badge variant={person.role === "owner" ? "secondary" : "outline"}>
                    {ROLE_LABEL[person.role]}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      {manager && invites.length ? (
        <SettingsSection
          title="Pending invites"
          description="Links stay valid until someone joins or you revoke them."
        >
          <ul className="divide-y rounded-lg border">
            {invites.map((inv) => (
              <li key={inv.token} className="enter-up flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                  <EnvelopeSimpleIcon className="size-3.5" />
                </span>
                <div className="min-w-[200px] flex-1">
                  <p className="truncate text-[13.5px]">{inv.email}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {ROLE_LABEL[inv.role]} · invited by {inv.invitedBy} ·{" "}
                    {formatDistanceToNowStrict(new Date(inv.invitedAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="ml-11 flex gap-2 sm:ml-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(inviteUrl(inv.token), "Invite link copied")}
                  >
                    <CopyIcon data-icon="inline-start" />
                    Copy link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      revokeInvite(ws.id, inv.token);
                      toast(`Invite for ${inv.email} revoked`);
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      {ws.isShared ? (
        <SettingsSection
          title="Leave workspace"
          tone="danger"
          description="You'll lose access until someone invites you again."
        >
          <div>
            <ConfirmDeleteDialog
              trigger={
                <Button variant="destructive">
                  <SignOutIcon data-icon="inline-start" />
                  Leave workspace
                </Button>
              }
              title={`Leave ${ws.name}?`}
              description="The workspace and its records stay with the owner."
              label={`Type ${ws.name} to confirm`}
              expected={ws.name}
              actionLabel="Leave workspace"
              onConfirm={() => {
                router.replace("/");
                leaveWorkspace(ws.id);
                toast(`You left ${ws.name}`);
                return undefined;
              }}
            />
          </div>
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}
