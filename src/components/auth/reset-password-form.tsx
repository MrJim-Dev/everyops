"use client";

import { CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { resetPassword } from "@/lib/auth/client";
import { type FormErrors, fieldErrors, resetPasswordSchema } from "@/lib/auth/schemas";
import { AuthLink, AuthShell } from "./auth-shell";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";
import { SubmitButton } from "./submit-button";
import { useFieldIds } from "./use-field-ids";

export function ResetPasswordForm() {
  const ids = useFieldIds("password", "confirm");
  const params = useSearchParams();
  // Better Auth redirects here with ?error=INVALID_TOKEN when a link is used or expired.
  const token = params.get("error") ? null : params.get("token");
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthShell
        title="This link isn't valid"
        description="Reset links can only be used once and expire after 30 minutes."
        footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
      >
        <Button className="h-10 w-full" render={<Link href="/forgot-password" />} nativeButton={false}>
          Request a new link
        </Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated" description="You can now sign in with your new password.">
        <div className="flex flex-col items-center gap-5">
          <span className="flex size-12 animate-pop items-center justify-center rounded-full bg-primary/15 text-primary">
            <CheckIcon className="size-5" />
          </span>
          <Button className="h-10 w-full" render={<Link href="/sign-in" />} nativeButton={false}>
            Sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = resetPasswordSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setPending(true);
    const result = await resetPassword(token, parsed.data.password);
    setPending(false);
    if (result.ok) setDone(true);
    else setFailure(result.message);
  };

  return (
    <AuthShell
      title="Choose a new password"
      description="Use something you don't use anywhere else."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure ? (
          <div className="flex flex-col gap-2">
            <FormAlert message={failure} />
            <AuthLink href="/forgot-password">
              <span className="text-[12.5px]">Request a new link</span>
            </AuthLink>
          </div>
        ) : null}
        <FieldGroup className="gap-4">
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor={ids.password}>New password</FieldLabel>
            <PasswordInput
              id={ids.password}
              autoComplete="new-password"
              autoFocus
              value={values.password}
              onChange={(v) => setValues((s) => ({ ...s, password: v }))}
              invalid={!!errors.password}
            />
            <PasswordStrength password={values.password} />
            {errors.password ? <FieldError>{errors.password}</FieldError> : null}
          </Field>
          <Field data-invalid={errors.confirm ? true : undefined}>
            <FieldLabel htmlFor={ids.confirm}>Confirm password</FieldLabel>
            <PasswordInput
              id={ids.confirm}
              autoComplete="new-password"
              value={values.confirm}
              onChange={(v) => setValues((s) => ({ ...s, confirm: v }))}
              invalid={!!errors.confirm}
            />
            {errors.confirm ? <FieldError>{errors.confirm}</FieldError> : null}
          </Field>
        </FieldGroup>
        <SubmitButton pending={pending}>{pending ? "Updating…" : "Update password"}</SubmitButton>
      </form>
    </AuthShell>
  );
}
