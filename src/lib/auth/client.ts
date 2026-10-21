"use client";

import { createAuthClient } from "better-auth/react";
import { PRIVATE_BETA_CODE, PRIVATE_BETA_MESSAGE } from "./private-beta";

/** Better Auth client. Talks to /api/auth on the same origin. */
export const authClient = createAuthClient();

export { DEMO_ACCOUNT } from "./demo";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  createdAt: string;
};

export type AuthResult = { ok: true } | { ok: false; field?: string; message: string; code?: string };

type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

let signingOut = false;

/** True right after a deliberate sign-out, so guards don't remember the old page as "next". */
export function isSigningOut() {
  return signingOut;
}

function failure(error: AuthError, fallback: string, field?: string): AuthResult {
  if (error?.status === 429) return { ok: false, message: "Too many attempts. Wait a minute and try again." };
  return { ok: false, field, message: error?.message || fallback };
}

/** The signed-in user, or null (also null while the session is loading). */
export function useCurrentUser(): CurrentUser | null {
  const { data } = authClient.useSession();
  if (!data) return null;
  const { id, name, email, image, createdAt } = data.user;
  return { id, name, email, image, createdAt: new Date(createdAt).toISOString() };
}

/** True once the session has been checked with the server. */
export function useAuthReady(): boolean {
  return !authClient.useSession().isPending;
}

export async function signUp(input: { name: string; email: string; password: string }): Promise<AuthResult> {
  const { error } = await authClient.signUp.email({ ...input, name: input.name.trim() });
  if (!error) return { ok: true };
  if (error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")
    return { ok: false, field: "email", message: "An account with this email already exists" };
  if (error.code === PRIVATE_BETA_CODE)
    return { ok: false, code: PRIVATE_BETA_CODE, message: PRIVATE_BETA_MESSAGE };
  return failure(error, "We couldn't create your account. Try again.");
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  const { error } = await authClient.signIn.email(input);
  if (!error) return { ok: true };
  // Same message for unknown email and wrong password, so accounts can't be probed.
  if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD")
    return { ok: false, message: "That email and password don't match" };
  return failure(error, "We couldn't sign you in. Try again.");
}

export function signInWithGoogle(next: string) {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: next,
    errorCallbackURL: next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`,
  });
}

/** What to tell someone Google sent back with an `error` code, so a failed sign-in never looks like nothing happened. */
export function googleErrorMessage(code: string): string {
  switch (code) {
    case "access_denied":
      return "Google sign-in was cancelled.";
    case "account_not_linked":
    case "unable_to_link_account":
      return "We couldn't connect Google to the account with this email. Sign in with your password instead.";
    case "account_already_linked_to_different_user":
      return "That Google account is already connected to a different EveryOps account.";
    case PRIVATE_BETA_CODE:
      return PRIVATE_BETA_MESSAGE;
    default:
      return "Google sign-in didn't finish. Try again, or use your email and password.";
  }
}

export async function signOut() {
  signingOut = true;
  try {
    await authClient.signOut();
  } finally {
    setTimeout(() => {
      signingOut = false;
    }, 1000);
  }
}

/** Always resolves the same way, whether or not the account exists. */
export async function requestReset(email: string): Promise<void> {
  await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
}

export async function resetPassword(token: string, password: string): Promise<AuthResult> {
  const { error } = await authClient.resetPassword({ token, newPassword: password });
  if (!error) return { ok: true };
  if (error.code === "INVALID_TOKEN" || error.status === 400)
    return { ok: false, message: "This reset link has expired. Request a new one." };
  return failure(error, "We couldn't reset your password. Try again.");
}

export async function updateProfile(name: string): Promise<AuthResult> {
  const { error } = await authClient.updateUser({ name: name.trim() });
  return error ? failure(error, "We couldn't save your profile.") : { ok: true };
}

export async function changePassword(current: string, next: string): Promise<AuthResult> {
  const { error } = await authClient.changePassword({
    currentPassword: current,
    newPassword: next,
    revokeOtherSessions: true,
  });
  if (!error) return { ok: true };
  if (error.code === "INVALID_PASSWORD" || error.status === 400)
    return { ok: false, field: "current", message: "That's not your current password" };
  return failure(error, "We couldn't change your password.", "current");
}

/** Deletes the signed-in account after confirming its password. */
export async function deleteAccount(password: string): Promise<AuthResult> {
  const { error } = await authClient.deleteUser({ password });
  if (!error) return { ok: true };
  if (error.code === "INVALID_PASSWORD" || error.status === 400)
    return { ok: false, field: "password", message: "That password isn't right" };
  return failure(error, "We couldn't delete your account.", "password");
}
