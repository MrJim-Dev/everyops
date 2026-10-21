import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WAITLIST_CODE, WAITLIST_MESSAGE } from "@/lib/auth/waitlist";
import { googleAccountLinking } from "./auth-linking";
import {
  allowlistedEmails,
  mayRegister,
  privateBetaEnabled,
  privateBetaGate,
  type WaitlistSource,
  type WaitlistStore,
} from "./private-beta";

type Row = Record<string, unknown>;
type WaitlistRow = {
  email: string;
  name: string | null;
  source: WaitlistSource;
  status: "waiting" | "approved";
  createdAt: Date;
  updatedAt: Date;
};

/** In-memory stand-in for the waitlist table, with the same upsert rules as waitlistTable's SQL. */
function memoryWaitlist() {
  const rows: WaitlistRow[] = [];
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 9, 22, 0, 0, clock++));
  const store: WaitlistStore = {
    async isApproved(email) {
      return rows.some((r) => r.email === email.trim().toLowerCase() && r.status === "approved");
    },
    async join({ email, name, source }) {
      const key = email.trim().toLowerCase();
      const row = rows.find((r) => r.email === key);
      if (row) {
        row.name = name ?? row.name;
        row.updatedAt = now();
      } else {
        const at = now();
        rows.push({ email: key, name, source, status: "waiting", createdAt: at, updatedAt: at });
      }
    },
  };
  const approve = (email: string) => {
    const row = rows.find((r) => r.email === email);
    if (row) row.status = "approved";
  };
  return { rows, store, approve };
}

/** A real Better Auth instance with the same hooks as src/server/auth.ts, plus the Google callback's user handling. */
function setup() {
  const tables: Record<string, Row[]> = { user: [], session: [], account: [], verification: [] };
  const waitlist = memoryWaitlist();
  const gate = privateBetaGate(waitlist.store);
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true, autoSignIn: true },
    socialProviders: { google: { clientId: "id", clientSecret: "secret" } },
    ...googleAccountLinking,
    databaseHooks: { ...googleAccountLinking.databaseHooks, ...gate.databaseHooks },
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
  const signUp = (email: string, name = "Someone") =>
    auth.api.signUpEmail({ body: { name, email, password: "password123" } });
  const googleSignIn = (sub: string, email: string) =>
    auth.api.googleCallback({ body: { sub, email } }) as Promise<{
      error: string | null;
      userId: string | null;
    }>;
  return { auth, tables, waitlist, signUp, googleSignIn };
}

const gateOn = (list = "invited@example.com, Second@Example.com") => {
  vi.stubEnv("PRIVATE_BETA_ENABLED", "true");
  vi.stubEnv("PRIVATE_BETA_ALLOWLIST", list);
};

/** The error the gate throws; the Google callback turns its code into ?error=waitlist. */
async function waitlistError(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(APIError);
  return (error as APIError).body;
}

afterEach(() => vi.unstubAllEnvs());

describe("private beta, flag on", () => {
  it("lets an allowlisted email register, in any case, without touching the waitlist", async () => {
    gateOn();
    const { tables, waitlist, signUp, googleSignIn } = setup();

    const made = await signUp("INVITED@example.com");
    const google = await googleSignIn("google-sub-1", "second@example.com");

    expect(made.user.email).toBe("invited@example.com");
    expect(google.error).toBeNull();
    expect(tables.user.map((u) => u.email)).toEqual(["invited@example.com", "second@example.com"]);
    expect(waitlist.rows).toHaveLength(0);
  });

  it("puts a non-allowed email on the waitlist once, however many times it tries, and creates nothing", async () => {
    gateOn();
    const { tables, waitlist, signUp, googleSignIn } = setup();

    const first = await waitlistError(signUp("Stranger@Example.com", "Sam Stranger"));
    const second = await waitlistError(signUp("stranger@example.com", "Sam S."));
    const fromGoogle = await waitlistError(googleSignIn("google-sub-2", "stranger@example.com"));

    for (const body of [first, second, fromGoogle])
      expect(body).toMatchObject({ code: WAITLIST_CODE, message: WAITLIST_MESSAGE });
    expect(waitlist.rows).toHaveLength(1);
    const [row] = waitlist.rows;
    expect(row).toMatchObject({ email: "stranger@example.com", source: "email", status: "waiting" });
    expect(row.createdAt.getTime()).toBeLessThan(row.updatedAt.getTime());
    expect(tables.user).toHaveLength(0);
    expect(tables.account).toHaveLength(0);
    expect(tables.session).toHaveLength(0);
  });

  it("records a first Google sign-in as source google, with no password anywhere", async () => {
    gateOn();
    const { tables, waitlist, googleSignIn } = setup();

    await waitlistError(googleSignIn("google-sub-6", "new-google@example.com"));

    expect(waitlist.rows).toEqual([
      expect.objectContaining({ email: "new-google@example.com", source: "google" }),
    ]);
    expect(Object.keys(waitlist.rows[0])).not.toContain("password");
    expect(tables.account).toHaveLength(0);
  });

  it("lets an approved waitlist email register", async () => {
    gateOn();
    const { tables, waitlist, signUp, googleSignIn } = setup();
    await waitlistError(signUp("later@example.com"));
    await waitlistError(googleSignIn("google-sub-7", "later-google@example.com"));

    waitlist.approve("later@example.com");
    waitlist.approve("later-google@example.com");
    const made = await signUp("Later@example.com");
    const google = await googleSignIn("google-sub-7", "later-google@example.com");

    expect(made.user.email).toBe("later@example.com");
    expect(google.error).toBeNull();
    expect(tables.user).toHaveLength(2);
    expect(waitlist.rows).toHaveLength(2);
  });

  it("still lets existing users who aren't allowed sign in, with a password or Google", async () => {
    const { auth, tables, waitlist, signUp, googleSignIn } = setup();
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
    expect(waitlist.rows).toHaveLength(0);
  });
});

describe("private beta, flag off", () => {
  it("lets anyone register and never writes to the waitlist when the flag is unset or not true", async () => {
    for (const flag of [undefined, "", "false", "0"]) {
      vi.stubEnv("PRIVATE_BETA_ENABLED", flag);
      vi.stubEnv("PRIVATE_BETA_ALLOWLIST", "invited@example.com");
      const { tables, waitlist, signUp, googleSignIn } = setup();

      await signUp("anyone@example.com");
      const google = await googleSignIn("google-sub-5", "someone-else@example.com");

      expect(google.error).toBeNull();
      expect(tables.user).toHaveLength(2);
      expect(waitlist.rows).toHaveLength(0);
    }
  });

  it("doesn't read the waitlist at all", async () => {
    const isApproved = vi.fn(async () => false);
    const join = vi.fn(async () => {});
    expect(await mayRegister("anyone@example.com", { isApproved, join }, {})).toBe(true);
    expect(isApproved).not.toHaveBeenCalled();
  });
});

describe("allowlist parsing", () => {
  it("splits on commas, semicolons and whitespace and ignores case and blanks", async () => {
    const env = { PRIVATE_BETA_ALLOWLIST: " A@x.com,b@x.com;\n c@X.COM ,, " };
    const none = memoryWaitlist().store;
    expect([...allowlistedEmails(env)]).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(privateBetaEnabled({ PRIVATE_BETA_ENABLED: "on" })).toBe(true);
    expect(await mayRegister(" C@x.com ", none, { ...env, PRIVATE_BETA_ENABLED: "on" })).toBe(true);
    expect(await mayRegister("d@x.com", none, { ...env, PRIVATE_BETA_ENABLED: "TRUE" })).toBe(false);
    expect(await mayRegister("d@x.com", none, { PRIVATE_BETA_ENABLED: "true" })).toBe(false);
  });
});
