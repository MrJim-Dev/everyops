import { SpinnerGapIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button
      type="submit"
      size="lg"
      className="h-10 w-full text-[14px]"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? <SpinnerGapIcon data-icon="inline-start" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
