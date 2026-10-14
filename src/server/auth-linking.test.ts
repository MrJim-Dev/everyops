import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthEndpoint } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { googleAccountLinking } from "./auth-linking";

type Row = Record<string, unknown>;

/** A real Better Auth instance with EveryOps' linking rules, plus an endpoint that runs the Google callback's user handling. */
function setup() {
  const tables: Record<string, Row[]> = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true, autoSignIn: true },
    socialProviders: { google: { clientId: "id", clientSecret: "secret" } },
    ...googleAccountLinking,
    plugins: [
      {
        id: "google-callback-under-test",
        endpoints: {
          googleCallback: createAuthEndpoint(
            "/test/google-callback",
            { method: "POST", body: z.object({ sub: z.string(), email: z.string() }) },
            async (ctx) => {
              const { sub, email } = ctx.body;
              const result = await handleOAuthUserInfo(ctx, {
                userInfo: { id: sub, email, name: "Google User", emailVerified: true },
                account: { providerId: "google", accountId: sub },
                callbackURL: "/",
              });
              return ctx.json({ error: result.error ?? null, userId: result.data?.user.id ?? null });
            },
          ),
        },
      },
    ],
  });
  const googleSignIn = (sub: string, email: string) =>
    auth.api.googleCallback({ body: { sub, email } }) as Promise<{
      error: string | null;
      userId: string | null;
    }>;
  return { auth, tables, googleSignIn };
}

describe("Google sign-in for an existing email-and-password account", () => {
  it("signs in, links Google, and removes the unverified password", async () => {
    const { auth, tables, googleSignIn } = setup();
    await auth.api.signUpEmail({
      body: { name: "Owner", email: "owner@example.com", password: "password123" },
    });
    const userId = tables.user[0].id;
    expect(tables.user[0].emailVerified).toBe(false);

    const result = await googleSignIn("google-sub-1", "Owner@Example.com");

    expect(result).toEqual({ error: null, userId });
    expect(tables.user[0].emailVerified).toBe(true);
    expect(tables.account.map((a) => a.providerId)).toEqual(["google"]);
    // Only the session Google sign-in just created remains; the one from sign-up is gone.
    expect(tables.session).toHaveLength(1);
    await expect(
      auth.api.signInEmail({ body: { email: "owner@example.com", password: "password123" } }),
    ).rejects.toThrow();
  });

  it("signs a returning Google user back into the same account", async () => {
    const { tables, googleSignIn } = setup();
    const first = await googleSignIn("google-sub-2", "new@example.com");
    const second = await googleSignIn("google-sub-2", "new@example.com");

    expect(second).toEqual({ error: null, userId: first.userId });
    expect(tables.user).toHaveLength(1);
    expect(tables.account.map((a) => a.providerId)).toEqual(["google"]);
    expect(tables.session).toHaveLength(2);
  });
});
