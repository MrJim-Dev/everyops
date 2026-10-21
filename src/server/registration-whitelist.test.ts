import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PRIVATE_BETA_CODE, PRIVATE_BETA_MESSAGE } from "@/lib/auth/private-beta";
import { googleAccountLinking } from "./auth-linking";
import { mayRegister, registrationWhitelist, whitelistedEmails } from "./registration-whitelist";

type Row = Record<string, unknown>;

/** A real Better Auth instance with the same hooks as src/server/auth.ts, plus the Google callback's user handling. */
function setup() {
  const tables: Record<string, Row[]> = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true, autoSignIn: true },
    socialProviders: { google: { clientId: "id", clientSecret: "secret" } },
    ...googleAccountLinking,
    databaseHooks: { ...googleAccountLinking.databaseHooks, ...registrationWhitelist.databaseHooks },
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
  const signUp = (email: string) =>
    auth.api.signUpEmail({ body: { name: "Someone", email, password: "password123" } });
  const googleSignIn = (sub: string, email: string) =>
    auth.api.googleCallback({ body: { sub, email } }) as Promise<{
      error: string | null;
      userId: string | null;
    }>;
  return { auth, tables, signUp, googleSignIn };
}

const gateOn = (list = "invited@example.com, Second@Example.com") => {
  vi.stubEnv("REGISTRATION_WHITELIST_ENABLED", "true");
  vi.stubEnv("REGISTRATION_WHITELIST", list);
};

/** The error the gate throws; the Google callback turns its code into ?error=private_beta. */
async function privateBetaError(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(APIError);
  return (error as APIError).body;
}

afterEach(() => vi.unstubAllEnvs());

describe("registration whitelist, flag on", () => {
  it("lets a whitelisted email register, in any case", async () => {
    gateOn();
    const { tables, signUp, googleSignIn } = setup();

    const made = await signUp("INVITED@example.com");
    const google = await googleSignIn("google-sub-1", "second@example.com");

    expect(made.user.email).toBe("invited@example.com");
    expect(google.error).toBeNull();
    expect(tables.user.map((u) => u.email)).toEqual(["invited@example.com", "second@example.com"]);
  });

  it("rejects a non-whitelisted email with the private beta message, for email and Google sign-up", async () => {
    gateOn();
    const { tables, signUp, googleSignIn } = setup();

    const fromEmail = await privateBetaError(signUp("stranger@example.com"));
    const fromGoogle = await privateBetaError(googleSignIn("google-sub-2", "stranger@example.com"));

    for (const body of [fromEmail, fromGoogle])
      expect(body).toMatchObject({ code: PRIVATE_BETA_CODE, message: PRIVATE_BETA_MESSAGE });
    expect(tables.user).toHaveLength(0);
    expect(tables.account).toHaveLength(0);
    expect(tables.session).toHaveLength(0);
  });

  it("still lets existing users who aren't whitelisted sign in, with a password or Google", async () => {
    const { auth, tables, signUp, googleSignIn } = setup();
    const withPassword = await signUp("existing@example.com");
    const withGoogle = await googleSignIn("google-sub-3", "google-user@example.com");
    gateOn();

    const signedIn = await auth.api.signInEmail({
      body: { email: "Existing@Example.com", password: "password123" },
    });
    const again = await googleSignIn("google-sub-3", "google-user@example.com");
    // Google on an existing email-and-password account links to it; nothing new is created.
    const linked = await googleSignIn("google-sub-4", "existing@example.com");

    expect(signedIn.user.id).toBe(withPassword.user.id);
    expect(again).toEqual({ error: null, userId: withGoogle.userId });
    expect(linked).toEqual({ error: null, userId: withPassword.user.id });
    expect(tables.user).toHaveLength(2);
  });
});

describe("registration whitelist, flag off", () => {
  it("lets anyone register when the flag is unset or not true, even with a whitelist", async () => {
    for (const flag of [undefined, "", "false", "0"]) {
      vi.stubEnv("REGISTRATION_WHITELIST_ENABLED", flag);
      vi.stubEnv("REGISTRATION_WHITELIST", "invited@example.com");
      const { tables, signUp, googleSignIn } = setup();

      await signUp("anyone@example.com");
      const google = await googleSignIn("google-sub-5", "someone-else@example.com");

      expect(google.error).toBeNull();
      expect(tables.user).toHaveLength(2);
    }
  });
});

describe("whitelist parsing", () => {
  it("splits on commas, semicolons and whitespace and ignores case and blanks", () => {
    const env = { REGISTRATION_WHITELIST: " A@x.com,b@x.com;\n c@X.COM ,, " };
    expect([...whitelistedEmails(env)]).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(mayRegister(" C@x.com ", { ...env, REGISTRATION_WHITELIST_ENABLED: "on" })).toBe(true);
    expect(mayRegister("d@x.com", { ...env, REGISTRATION_WHITELIST_ENABLED: "TRUE" })).toBe(false);
    expect(mayRegister("d@x.com", { REGISTRATION_WHITELIST_ENABLED: "true" })).toBe(false);
  });
});
