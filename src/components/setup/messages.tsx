import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[14px] leading-relaxed">
        {children}
      </p>
    </div>
  );
}

export function AssistantMessage({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-foreground">
        <LogoMark className="size-3.5" />
      </span>
      <div className={cn("min-w-0 flex-1 pt-1 text-[14px] leading-relaxed", muted && "text-[13px]")}>
        {children}
      </div>
    </div>
  );
}
