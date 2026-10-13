"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { safeNext } from "@/lib/auth/redirect";
import { type FormErrors, fieldErrors, signUpSchema } from "@/lib/auth/schemas";
import { useAuth } from "@/lib/auth/store";
import { RedirectIfSignedIn } from "./auth-guards";
import { AuthLink, AuthShell } from "./auth-shell";
import { GoogleButton, OrDivider } from "./google-button";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";
import { SubmitButton } from "./submit-button";
import { useFieldIds } from "./use-field-ids";

export function SignUpForm() {
  const ids = useFieldIds("name", "email", "password");
  const params = useSearchParams();
  const next = params.get("next");
  const router = useRouter();
  const signUp = useAuth((s) => s.signUp);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = signUpSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setPending(true);
    const result = await signUp(parsed.data);
    setPending(false);
    if (result.ok) router.replace(safeNext(next));
    else setErrors({ [result.field ?? "email"]: result.message });
  };

  return (
    <RedirectIfSignedIn next={next}>
      <AuthShell
        title="Create your account"
        description="Describe your business. Hulma builds the systems it needs."
        footer={
          <>
            Already have an account?{" "}
            <AuthLink href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</AuthLink>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <GoogleButton />
          <OrDivider />
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
              <Field data-invalid={errors.name ? true : undefined}>
                <FieldLabel htmlFor={ids.name}>Full name</FieldLabel>
                <Input
                  id={ids.name}
                  autoComplete="name"
                  autoFocus
                  className="h-10"
                  aria-invalid={errors.name ? true : undefined}
                  value={values.name}
                  onChange={(e) => set("name")(e.target.value)}
                />
                {errors.name ? <FieldError>{errors.name}</FieldError> : null}
              </Field>
              <Field data-invalid={errors.email ? true : undefined}>
                <FieldLabel htmlFor={ids.email}>Work email</FieldLabel>
                <Input
                  id={ids.email}
                  type="email"
                  autoComplete="email"
                  className="h-10"
                  aria-invalid={errors.email ? true : undefined}
                  value={values.email}
                  onChange={(e) => set("email")(e.target.value)}
                />
                {errors.email ? <FieldError>{errors.email}</FieldError> : null}
              </Field>
              <Field data-invalid={errors.password ? true : undefined}>
                <FieldLabel htmlFor={ids.password}>Password</FieldLabel>
                <PasswordInput
                  id={ids.password}
                  autoComplete="new-password"
                  value={values.password}
                  onChange={set("password")}
                  invalid={!!errors.password}
                />
                <PasswordStrength password={values.password} />
                {errors.password ? (
                  <FieldError>{errors.password}</FieldError>
                ) : (
                  <FieldDescription>At least 8 characters, with a letter and a number.</FieldDescription>
                )}
              </Field>
            </FieldGroup>
            <SubmitButton pending={pending}>{pending ? "Creating account…" : "Create account"}</SubmitButton>
            <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
              By creating an account you agree to the <AuthLink href="/terms">Terms</AuthLink> and{" "}
              <AuthLink href="/privacy">Privacy Policy</AuthLink>.
            </p>
          </form>
        </div>
      </AuthShell>
    </RedirectIfSignedIn>
  );
}
