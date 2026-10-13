import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Small square monogram used for workspaces in the switcher and lists. */
export function WorkspaceTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-secondary text-[10px] font-semibold text-foreground ring-1 ring-border",
        className,
      )}
    >
      {initials(name).slice(0, 1)}
    </span>
  );
}
