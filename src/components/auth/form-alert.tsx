import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

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
