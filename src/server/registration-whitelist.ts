import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { PRIVATE_BETA_CODE, PRIVATE_BETA_MESSAGE } from "@/lib/auth/private-beta";

type Env = Record<string, string | undefined>;

/** REGISTRATION_WHITELIST_ENABLED turns the gate on ("true", "1", "yes" or "on"). Off when unset. */
export function whitelistEnabled(env: Env = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.REGISTRATION_WHITELIST_ENABLED?.trim() ?? "");
}

/** REGISTRATION_WHITELIST: emails separated by commas, semicolons or whitespace, compared lowercased. */
export function whitelistedEmails(env: Env = process.env): Set<string> {
  return new Set(
    (env.REGISTRATION_WHITELIST ?? "")
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Whether a new account may be created for this email. Always true while the gate is off. */
export function mayRegister(email: string, env: Env = process.env): boolean {
  if (!whitelistEnabled(env)) return true;
  return whitelistedEmails(env).has(email.trim().toLowerCase());
}

/**
 * Private beta: with the gate on, only whitelisted emails can create an account.
 *
 * Better Auth runs this hook whenever it is about to create a user, which covers email sign-up and a first
 * Google sign-in, and never when an existing user signs in (or links Google to their account). So existing
 * users always get in. The env is read on every call, so tests and deploys change it without a restart.
 * The error code reaches the browser: as `error.code` from email sign-up, and as `?error=private_beta` on the
 * Google error redirect.
 */
export const registrationWhitelist = {
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!mayRegister(user.email))
            throw new APIError("FORBIDDEN", { code: PRIVATE_BETA_CODE, message: PRIVATE_BETA_MESSAGE });
        },
      },
    },
  },
} satisfies Partial<BetterAuthOptions>;
