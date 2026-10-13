"use client";

import { type ReactElement, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Irreversible actions ask for proof of intent: typing a name or a password.
 * `onConfirm` returns an error message to show, or nothing on success.
 */
export function ConfirmDeleteDialog({
  trigger,
  title,
  description,
  label,
  expected,
  inputType = "text",
  actionLabel,
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  description: string;
  label: string;
  /** When set, the action unlocks only once the input matches exactly. */
  expected?: string;
  inputType?: "text" | "password";
  actionLabel: string;
  onConfirm: (value: string) => Promise<string | undefined> | string | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const ready = expected ? value === expected : value.length > 0;

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    const message = await onConfirm(value);
    setPending(false);
    if (message) setError(message);
    else setOpen(false);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setValue("");
          setError(undefined);
        }
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent className="sm:max-w-[420px]">
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id} className="font-normal text-muted-foreground">
              {label}
            </FieldLabel>
            <Input
              id={id}
              type={inputType}
              autoFocus
              autoComplete={inputType === "password" ? "current-password" : "off"}
              aria-invalid={error ? true : undefined}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(undefined);
              }}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!ready || pending}>
              {pending ? "Deleting…" : actionLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
