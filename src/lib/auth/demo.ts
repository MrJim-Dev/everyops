/** The seeded demo account (see scripts/db-seed.ts). */
export const DEMO_ACCOUNT = { name: "James Ocampo", email: "james@everyops.app", password: "everyops2026" };

/**
 * The demo account is shared by everyone, so it can explore and edit freely but can't change its
 * login, invite people, or publish. Its data resets every night (POST /api/cron/reset-demo).
 */
export const isDemoEmail = (email: string | null | undefined) =>
  !!email && email.trim().toLowerCase() === DEMO_ACCOUNT.email;

export const DEMO_LOCKED_MESSAGE =
  "This is the shared demo account, so this is turned off. Create your own account to use it.";
