"use client";

import {
  CaretUpDownIcon,
  DownloadSimpleIcon,
  HouseIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useInstall } from "@/lib/pwa/install";
import { cn } from "@/lib/utils";

function useSignOut() {
  const router = useRouter();
  return async () => {
    await signOut();
    router.replace("/sign-in");
    toast.success("Signed out");
  };
}

/** Account menu: avatar trigger in the top bar, full row in the sidebar. */
export function UserMenu({ variant }: { variant: "topbar" | "sidebar" }) {
  const user = useCurrentUser();
  const router = useRouter();
  const signOut = useSignOut();
  const ready = useAuthReady();
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { state: installState, install } = useInstall();
  const [iosSteps, setIosSteps] = useState(false);

  if (!ready) return <span aria-hidden="true" className={variant === "sidebar" ? "h-9 flex-1" : "h-8 w-8"} />;

  if (!user) {
    return variant === "topbar" ? (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" render={<Link href="/sign-in" />} nativeButton={false}>
          Sign in
        </Button>
        <Button
          size="sm"
          className="hidden sm:inline-flex"
          render={<Link href="/sign-up" />}
          nativeButton={false}
        >
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
    <>
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
            <DropdownMenuItem onClick={() => router.push("/workspaces")}>
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
            {installState === "prompt" || installState === "ios" ? (
              <DropdownMenuItem
                onClick={() => {
                  if (installState === "ios") setIosSteps(true);
                  else
                    void install().then((ok) => {
                      if (ok)
                        toast.success("EveryOps is installed", {
                          description: "Open it from your home screen or dock.",
                        });
                    });
                }}
              >
                <DownloadSimpleIcon />
                Install app
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => setConfirmOut(true)}>
              <SignOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOut} onOpenChange={(open) => !signingOut && setConfirmOut(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of EveryOps?</AlertDialogTitle>
            <AlertDialogDescription>
              You're signed in as {user.email}. You'll need your password to get back into your workspaces.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await signOut();
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={iosSteps} onOpenChange={setIosSteps}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add EveryOps to your home screen</AlertDialogTitle>
            <AlertDialogDescription>
              It opens full screen, like an app, so the front desk tablet can keep it one tap away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px]">
            <li>
              Tap <span className="font-medium">Share</span> in Safari's toolbar.
            </li>
            <li>
              Choose <span className="font-medium">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="font-medium">Add</span>.
            </li>
          </ol>
          <AlertDialogFooter>
            <AlertDialogAction>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
