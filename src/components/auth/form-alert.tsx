import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

/** Form-level error. Keyed by the caller so each new failure shakes once. */
export function FormAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex animate-shake items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive"
    >
      <WarningCircleIcon className="mt-px size-4 shrink-0" />
      {message}
    </div>
  );
}

/** Calm notice for a sign-up the private beta put on the waitlist. */
export function FormNotice({ message }: { message: string }) {
  return (
    <output className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground">
      <InfoIcon className="mt-px size-4 shrink-0 text-muted-foreground" />
      {message}
    </output>
  );
}
