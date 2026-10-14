import type { BetterAuthOptions } from "better-auth";

/**
 * Someone who signed up with email and password can later continue with Google on the same address.
 *
 * EveryOps never verifies email addresses itself, so Better Auth's default (link only to verified local
 * accounts) would refuse every such sign-in and send the user back to /sign-in. Google proves the address
 * instead. Because whoever chose the existing password may not own the address, linking Google to an
 * unverified account removes that password and signs out its open sessions; the owner can set a new
 * password with "Forgot password".
 */
export const googleAccountLinking = {
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"], requireLocalEmailVerified: false },
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account, ctx) => {
          if (account.providerId !== "google" || !ctx) return;
          const adapter = ctx.context.internalAdapter;
          const user = await adapter.findUserById(account.userId);
          // New Google users arrive verified, so only a link to an existing unverified account gets here.
          if (!user || user.emailVerified) return;
          const accounts = await adapter.findAccounts(user.id);
          for (const other of accounts)
            if (other.providerId === "credential") await adapter.deleteAccount(other.id);
          await adapter.deleteUserSessions(user.id);
        },
      },
    },
  },
} satisfies Partial<BetterAuthOptions>;
