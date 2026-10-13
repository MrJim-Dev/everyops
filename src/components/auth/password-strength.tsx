import { passwordStrength } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

/** Four segments that fill as the password improves. Colour is backed by a text label. */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordStrength(password);
  const tone = score <= 1 ? "bg-destructive" : score === 2 ? "bg-warning" : "bg-primary";
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full origin-left rounded-full transition-[transform,background-color] duration-300 ease-(--ease-out-strong)",
                tone,
                i < score ? "scale-x-100" : "scale-x-0",
              )}
            />
          </span>
        ))}
      </div>
      <span className="w-16 text-right text-[12px] text-muted-foreground">{LABELS[score]}</span>
    </div>
  );
}
