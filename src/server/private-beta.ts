import { randomUUID } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { sql } from "kysely";
import { WAITLIST_CODE, WAITLIST_MESSAGE } from "@/lib/auth/waitlist";
import { db } from "./db";

type Env = Record<string, string | undefined>;

export type WaitlistSource = "email" | "google";

/** Where waitlisted people are kept. Postgres in the app (`waitlistTable`); tests pass an in-memory one. */
export type WaitlistStore = {
  /** Whether the email's waitlist row has status 'approved'. */
  isApproved(email: string): Promise<boolean>;
  /**
   * Adds the email, or refreshes its row if it's already there (created_at, source and status stay). True when it's
   * new, so the admins hear about each person once.
   */
  join(entry: { email: string; name: string | null; source: WaitlistSource }): Promise<boolean>;
};

const normalize = (email: string) => email.trim().toLowerCase();

/** PRIVATE_BETA_ENABLED turns the gate on ("true", "1", "yes" or "on"). Off when unset. */
export function privateBetaEnabled(env: Env = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.PRIVATE_BETA_ENABLED?.trim() ?? "");
}

/** PRIVATE_BETA_ALLOWLIST: emails separated by commas, semicolons or whitespace, compared lowercased. */
export function allowlistedEmails(env: Env = process.env): Set<string> {
  return new Set(
    (env.PRIVATE_BETA_ALLOWLIST ?? "")
      .split(/[\s,;]+/)
      .map(normalize)
      .filter(Boolean),
  );
}

/**
 * The waitlist table (migration 0021). It writes through the app's own connection, outside Better Auth's
 * sign-up transaction, so the row stays when the gate then refuses the account and that transaction rolls back.
 */
export const waitlistTable: WaitlistStore = {
  async isApproved(email) {
    const { rows } = await sql<{ approved: boolean }>`
      select true as approved from waitlist where email = ${normalize(email)} and status = 'approved'`.execute(
      db,
    );
    return rows.length > 0;
  },
  async join({ email, name, source }) {
    const { rows } = await sql<{ inserted: boolean }>`
      insert into waitlist (id, email, name, source)
      values (${randomUUID()}, ${normalize(email)}, ${name}, ${source})
      on conflict (email) do update
        set name = coalesce(excluded.name, waitlist.name), updated_at = now()
      returning (xmax = 0) as inserted`.execute(db);
    return rows[0]?.inserted === true;
  },
};

/** Whether a new account may be created for this email: always while the gate is off, else allowlisted or approved. */
export async function mayRegister(
  email: string,
  store: WaitlistStore = waitlistTable,
  env: Env = process.env,
): Promise<boolean> {
  if (!privateBetaEnabled(env)) return true;
  if (allowlistedEmails(env).has(normalize(email))) return true;
  return store.isApproved(email);
}

/**
 * Private beta: with the gate on, only allowlisted or approved emails can create an account; anyone else is put on
 * the waitlist and told so.
 *
 * Better Auth runs this hook whenever it is about to create a user, which covers email sign-up and a first Google
 * sign-in, and never when an existing user signs in (or links Google to their account). So existing users always
 * get in. With the gate off it returns before touching the database. The env is read on every call, so tests and
 * deploys change it without a restart. The error code reaches the browser: as `error.code` from email sign-up,
 * and as `?error=waitlist` on the Google error redirect.
 */
export function privateBetaGate(
  store: WaitlistStore = waitlistTable,
  /** Told about each new person on the waitlist (the site admins' email). A failure here never blocks the answer. */
  onJoined?: (entry: { email: string; name: string | null; source: WaitlistSource }) => Promise<void>,
) {
  return {
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (await mayRegister(user.email, store)) return;
            // Email sign-up is the only path that creates users at /sign-up; every other one is the Google callback.
            const source: WaitlistSource = ctx?.path?.startsWith("/sign-up") ? "email" : "google";
            const entry = { email: user.email, name: user.name?.trim() || null, source };
            if ((await store.join(entry)) && onJoined) await onJoined(entry).catch(() => {});
            throw new APIError("FORBIDDEN", { code: WAITLIST_CODE, message: WAITLIST_MESSAGE });
          },
        },
      },
    },
  } satisfies Partial<BetterAuthOptions>;
}

export const privateBeta = privateBetaGate(waitlistTable, (entry) =>
  import("./waitlist-admin").then((m) => m.notifyAdminsOfJoin(entry)),
);
