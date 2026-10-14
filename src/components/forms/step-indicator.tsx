import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Numbered steps with the current one highlighted. Finished steps can be revisited by clicking them. With more than
 * three steps only the current one shows its title (the rest show it on hover), so titles never run into each other.
 */
export function StepIndicator({
  steps,
  current,
  onSelect,
}: {
  steps: string[];
  current: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-2" aria-label="Steps">
      {steps.map((title, i) => {
        const done = i < current;
        const active = i === current;
        const labelled = steps.length <= 3 || active;
        return (
          <li key={title} className={cn("flex min-w-0 items-center gap-2", i < steps.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!done || !onSelect}
              onClick={() => onSelect?.(i)}
              aria-current={active ? "step" : undefined}
              aria-label={labelled ? undefined : `Step ${i + 1}: ${title}`}
              title={labelled ? undefined : title}
              className="flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11.5px] tabular transition-colors",
                  active && "border-primary bg-primary text-primary-foreground",
                  done && "border-primary/60 bg-primary/15 text-foreground",
                  !active && !done && "text-muted-foreground",
                )}
              >
                {done ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              {labelled ? (
                <span
                  className={cn(
                    "hidden truncate text-[12.5px] sm:inline",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {title}
                </span>
              ) : null}
            </button>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn("h-px min-w-3 flex-1", done ? "bg-primary/60" : "bg-border")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
