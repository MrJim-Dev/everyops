import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      <AvatarFallback className="text-[9px] font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function PersonChip({ name }: { name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PersonAvatar name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}
