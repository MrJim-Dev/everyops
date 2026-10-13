"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DEMO_ACCOUNT, signIn } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/redirect";
import { type FormErrors, fieldErrors, signInSchema } from "@/lib/auth/schemas";
import { RedirectIfSignedIn } from "./auth-guards";
import { AuthLink, AuthShell } from "./auth-shell";
import { FormAlert } from "./form-alert";
import { GoogleButton, OrDivider } from "./google-button";
import { PasswordInput } from "./password-input";
import { SubmitButton } from "./submit-button";
import { useFieldIds } from "./use-field-ids";

export function SignInForm() {
  const ids = useFieldIds("email", "password");
  const params = useSearchParams();
  const next = params.get("next");
  const router = useRouter();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<{ message: string; attempt: number } | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setPending(true);
    const result = await signIn(parsed.data);
    setPending(false);
    if (result.ok) router.replace(safeNext(next));
    else setFailure((f) => ({ message: result.message, attempt: (f?.attempt ?? 0) + 1 }));
  };

  return (
    <RedirectIfSignedIn next={next}>
      <AuthShell
        title="Sign in to EveryOps"
        description="Welcome back. Your workspaces are waiting."
        footer={
          <>
            New to EveryOps?{" "}
            <AuthLink href={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
              Create an account
            </AuthLink>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <GoogleButton next={safeNext(next)} />
          <OrDivider />
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            {failure ? <FormAlert key={failure.attempt} message={failure.message} /> : null}
            <FieldGroup className="gap-4">
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
              <Field data-invalid={errors.password ? true : undefined}>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor={ids.password}>Password</FieldLabel>
                  <AuthLink href="/forgot-password">
                    <span className="text-[12.5px] font-normal text-muted-foreground hover:text-foreground">
                      Forgot password?
                    </span>
                  </AuthLink>
                </div>
                <PasswordInput
                  id={ids.password}
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                  invalid={!!errors.password}
                />
                {errors.password ? <FieldError>{errors.password}</FieldError> : null}
              </Field>
            </FieldGroup>
            <SubmitButton pending={pending}>{pending ? "Signing in…" : "Sign in"}</SubmitButton>
          </form>
          <button
            type="button"
            onClick={() => {
              setEmail(DEMO_ACCOUNT.email);
              setPassword(DEMO_ACCOUNT.password);
              setErrors({});
              setFailure(null);
            }}
            className="self-center rounded-sm text-[12.5px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Fill in the demo account
          </button>
        </div>
      </AuthShell>
    </RedirectIfSignedIn>
  );
}
