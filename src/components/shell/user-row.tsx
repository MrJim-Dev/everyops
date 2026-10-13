import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/** The signed-in person. Hackathon build: a single owner account. */
export function UserRow() {
  return (
    <div className="flex min-w-0 items-center gap-2 px-1.5 py-1">
      <Avatar className="size-6">
        <AvatarFallback className="text-[10px]">JO</AvatarFallback>
      </Avatar>
      <span className="truncate text-[13px] text-sidebar-foreground">James Ocampo</span>
    </div>
  );
}
