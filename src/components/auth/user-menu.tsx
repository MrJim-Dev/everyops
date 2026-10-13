"use client";

import {
  CaretUpDownIcon,
  HouseIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut, useAuthReady, useCurrentUser } from "@/lib/auth/client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

function useSignOut() {
  const router = useRouter();
  return async () => {
    await signOut();
    router.replace("/sign-in");
    toast("Signed out");
  };
}

/** Account menu: avatar trigger in the top bar, full row in the sidebar. */
export function UserMenu({ variant }: { variant: "topbar" | "sidebar" }) {
  const user = useCurrentUser();
  const router = useRouter();
  const signOut = useSignOut();
  const ready = useAuthReady();

  if (!ready) return <span aria-hidden="true" className={variant === "sidebar" ? "h-9 flex-1" : "h-8 w-8"} />;

  if (!user) {
    return variant === "topbar" ? (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" render={<Link href="/sign-in" />} nativeButton={false}>
          Sign in
        </Button>
        <Button size="sm" render={<Link href="/sign-up" />} nativeButton={false}>
          Create account
        </Button>
      </div>
    ) : (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        render={<Link href="/sign-in" />}
        nativeButton={false}
      >
        Sign in
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
          variant === "sidebar"
            ? "h-9 flex-1 px-1.5 hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
            : "h-8 px-1 hover:bg-muted data-popup-open:bg-muted",
        )}
        aria-label="Account"
      >
        <Avatar className={variant === "sidebar" ? "size-6" : "size-7"}>
          <AvatarFallback className="text-[10px]">{initials(user.name)}</AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "min-w-0 truncate text-left text-[13px]",
            variant === "sidebar" ? "flex-1 text-sidebar-foreground" : "hidden sm:inline",
          )}
        >
          {user.name}
        </span>
        {variant === "sidebar" ? (
          <CaretUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        className="w-60"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="truncate text-[13px] font-medium text-foreground">{user.name}</span>
            <span className="truncate text-[12px] font-normal text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/")}>
            <HouseIcon />
            Your workspaces
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/community")}>
            <SquaresFourIcon />
            Community systems
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/account")}>
            <UserCircleIcon />
            Account settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={signOut}>
            <SignOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
