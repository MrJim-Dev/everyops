"use client";

import { TrashIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { useFieldIds } from "@/components/auth/use-field-ids";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changePassword, deleteAccount, updateProfile, useCurrentUser } from "@/lib/auth/client";
import { isDemoEmail } from "@/lib/auth/demo";
import { changePasswordSchema, type FormErrors, fieldErrors, profileSchema } from "@/lib/auth/schemas";
import { formatDate, initials } from "@/lib/format";
import { useWorkspaces } from "@/lib/store/workspaces";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { SettingsPage, SettingsSection } from "./settings-section";

export function AccountSettings() {
  const user = useCurrentUser();
  const router = useRouter();
  const dropOwner = useWorkspaces((s) => s.dropOwner);
  const ids = useFieldIds("name", "email", "current", "password", "confirm");
  const [name, setName] = useState(user?.name ?? "");
  const [nameError, setNameError] = useState<string>();
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current: "", password: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<FormErrors>({});
  const [savingPw, setSavingPw] = useState(false);
  if (!user) return null;
  // The shared demo account keeps the same name and login for everyone.
  const demo = isDemoEmail(user.email);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = profileSchema.safeParse({ name });
    if (!parsed.success) return setNameError(fieldErrors(parsed.error).name);
    setSavingName(true);
    const result = await updateProfile(parsed.data.name);
    setSavingName(false);
    if (!result.ok) return setNameError(result.message);
    toast.success("Profile updated");
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse(pw);
    if (!parsed.success) return setPwErrors(fieldErrors(parsed.error));
    setSavingPw(true);
    const result = await changePassword(parsed.data.current, parsed.data.password);
    setSavingPw(false);
    if (!result.ok) return setPwErrors({ [result.field ?? "current"]: result.message });
    setPw({ current: "", password: "", confirm: "" });
    setPwErrors({});
    toast.success("Password changed");
  };
  const setPwField = (key: keyof typeof pw) => (value: string) => {
    setPw((p) => ({ ...p, [key]: value }));
    setPwErrors((e) => ({ ...e, [key]: undefined }));
  };

  return (
    <SettingsPage>
      <div className="flex items-center gap-4 pt-12 pb-8">
        <Avatar className="size-12">
          <AvatarFallback className="text-[15px]">{initials(user.name)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Account</h1>
          <p className="text-[13px] text-muted-foreground">
            Member since {formatDate(user.createdAt, { withYear: true })}
          </p>
        </div>
      </div>

      {demo ? (
        <p className="mb-6 rounded-lg border bg-card/40 px-4 py-3 text-[13px] text-muted-foreground">
          This is the shared demo account, so its name, password and deletion are locked, and its workspaces
          reset every night. Create your own account to keep your work.
        </p>
      ) : null}
      <fieldset disabled={demo} className="contents">
        <SettingsSection title="Profile" description="Shown on workspaces and changes you make.">
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
              <Field data-invalid={nameError ? true : undefined}>
                <FieldLabel htmlFor={ids.name}>Full name</FieldLabel>
                <Input
                  id={ids.name}
                  autoComplete="name"
                  className="h-9"
                  aria-invalid={nameError ? true : undefined}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(undefined);
                  }}
                />
                {nameError ? <FieldError>{nameError}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={ids.email}>Email</FieldLabel>
                <Input id={ids.email} className="h-9" value={user.email} readOnly disabled />
                <FieldDescription>Changing your email arrives with verified sign-in.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button
              type="submit"
              variant="outline"
              className="self-start"
              disabled={savingName || name.trim() === user.name}
            >
              {savingName ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </SettingsSection>

        <SettingsSection
          title="Password"
          description="Use at least 8 characters, with a letter and a number."
        >
          <form onSubmit={savePassword} noValidate className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
              <Field data-invalid={pwErrors.current ? true : undefined}>
                <FieldLabel htmlFor={ids.current}>Current password</FieldLabel>
                <PasswordInput
                  id={ids.current}
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={setPwField("current")}
                  invalid={!!pwErrors.current}
                />
                {pwErrors.current ? <FieldError>{pwErrors.current}</FieldError> : null}
              </Field>
              <Field data-invalid={pwErrors.password ? true : undefined}>
                <FieldLabel htmlFor={ids.password}>New password</FieldLabel>
                <PasswordInput
                  id={ids.password}
                  autoComplete="new-password"
                  value={pw.password}
                  onChange={setPwField("password")}
                  invalid={!!pwErrors.password}
                />
                <PasswordStrength password={pw.password} />
                {pwErrors.password ? <FieldError>{pwErrors.password}</FieldError> : null}
              </Field>
              <Field data-invalid={pwErrors.confirm ? true : undefined}>
                <FieldLabel htmlFor={ids.confirm}>Confirm new password</FieldLabel>
                <PasswordInput
                  id={ids.confirm}
                  autoComplete="new-password"
                  value={pw.confirm}
                  onChange={setPwField("confirm")}
                  invalid={!!pwErrors.confirm}
                />
                {pwErrors.confirm ? <FieldError>{pwErrors.confirm}</FieldError> : null}
              </Field>
            </FieldGroup>
            <Button type="submit" variant="outline" className="self-start" disabled={savingPw}>
              {savingPw ? "Updating…" : "Change password"}
            </Button>
          </form>
        </SettingsSection>

        <SettingsSection
          title="Delete account"
          tone="danger"
          description="Removes your account and every workspace it owns on this device. This can't be undone."
        >
          <div>
            <ConfirmDeleteDialog
              trigger={
                <Button variant="destructive">
                  <TrashIcon data-icon="inline-start" />
                  Delete account
                </Button>
              }
              title="Delete your account?"
              description="Your workspaces, records and history will be removed. Enter your password to confirm."
              label="Password"
              inputType="password"
              actionLabel="Delete account"
              onConfirm={async (password) => {
                const accountId = user.id;
                const result = await deleteAccount(password);
                if (!result.ok) return result.message;
                dropOwner(accountId);
                router.replace("/sign-in");
                toast("Account deleted");
                return undefined;
              }}
            />
          </div>
        </SettingsSection>
      </fieldset>
    </SettingsPage>
  );
}
