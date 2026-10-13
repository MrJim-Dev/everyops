"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type FormErrors, fieldErrors, forgotPasswordSchema } from "@/lib/auth/schemas";
import { useAuth } from "@/lib/auth/store";
import { AuthLink, AuthShell } from "./auth-shell";
import { SubmitButton } from "./submit-button";
import { useFieldIds } from "./use-field-ids";

export function ForgotPasswordForm() {
  const ids = useFieldIds("email");
  const requestReset = useAuth((s) => s.requestReset);
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<{ email: string; token: string | null } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setPending(true);
    const token = await requestReset(parsed.data.email);
    setPending(false);
    // Same confirmation whether or not the account exists, so emails can't be probed.
    setSent({ email: parsed.data.email, token });
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        description={
          <>
            If an account exists for <span className="text-foreground">{sent.email}</span>, we sent a link to
            reset your password. It expires in 30 minutes.
          </>
        }
        footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
      >
        <div className="flex flex-col items-center gap-4">
          <span className="flex size-12 animate-pop items-center justify-center rounded-full border text-primary">
            <EnvelopeSimpleIcon className="size-5" />
          </span>
          {sent.token ? (
            <div className="flex w-full flex-col gap-2 rounded-lg border bg-card/40 p-3 text-center">
              <p className="text-[12.5px] text-muted-foreground">
                Email isn't connected in this preview, so here's your reset link.
              </p>
              <Button
                variant="outline"
                render={<Link href={`/reset-password?token=${sent.token}`} />}
                nativeButton={false}
              >
                Open reset link
              </Button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setSent(null)}
            className="rounded-sm text-[12.5px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Use a different email
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you use for Hulma and we'll send you a reset link."
      footer={
        <>
          Remembered it? <AuthLink href="/sign-in">Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FieldGroup>
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor={ids.email}>Email</FieldLabel>
            <Input
              id={ids.email}
              type="email"
              autoComplete="email"
              autoFocus
              className="h-10"
              aria-invalid={errors.email ? true : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errors.email ? <FieldError>{errors.email}</FieldError> : null}
          </Field>
        </FieldGroup>
        <SubmitButton pending={pending}>{pending ? "Sending…" : "Send reset link"}</SubmitButton>
      </form>
    </AuthShell>
  );
}
