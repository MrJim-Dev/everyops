import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/redirect";
import { auth } from "./auth";

/** The signed-in session for this request, validated against the database (or its signed cookie cache). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Sends signed-out visitors to sign-in, then back to `next`. */
export async function requireSession(next: string) {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(safeNext(next))}`);
  return session;
}
