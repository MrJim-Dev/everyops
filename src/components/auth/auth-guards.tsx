"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { isSigningOut, useAuthReady, useCurrentUser } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/redirect";

/** Signed-out visitors go to sign-in and come back here afterwards. */
export function RequireAuth({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const ready = useAuthReady();
  const user = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready || user) return;
    // After a deliberate sign-out, the sign-out handler decides where to go.
    if (isSigningOut()) return;
    router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [ready, user, router, pathname]);

  return ready && user ? children : fallback;
}

/** Renders its children only for a signed-in account; nothing for visitors. */
export function SignedIn({ children }: { children: ReactNode }) {
  const ready = useAuthReady();
  const user = useCurrentUser();
  return ready && user ? children : null;
}

/** Auth pages bounce signed-in people to where they were going. */
export function RedirectIfSignedIn({ next, children }: { next: string | null; children: ReactNode }) {
  const ready = useAuthReady();
  const user = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (ready && user) router.replace(safeNext(next));
  }, [ready, user, router, next]);

  return ready && user ? null : children;
}
