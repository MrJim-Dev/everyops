import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import { db } from "./db";
import { waitlistApprovedEmail, waitlistJoinedEmail } from "./emails";
import { appUrl, sendMail } from "./mail";

/**
 * Running the private-beta waitlist (src/server/private-beta.ts): the site admins hear about each new person, can
 * approve them from the waitlist page or straight from that email, and the person is emailed when they're let in.
 */

type Env = Record<string, string | undefined>;
const normalize = (email: string) => email.trim().toLowerCase();

/** Who runs EveryOps itself: they get the waitlist emails and the waitlist page. */
export const DEFAULT_SITE_ADMINS = "james@everyops.app, jared@everyops.app";

/** SITE_ADMIN_EMAILS: who runs EveryOps itself (emails, comma or space separated). DEFAULT_SITE_ADMINS when unset. */
export function siteAdmins(env: Env = process.env): string[] {
  const list = (env.SITE_ADMIN_EMAILS ?? DEFAULT_SITE_ADMINS)
    .split(/[\s,;]+/)
    .map(normalize)
    .filter(Boolean);
  return [...new Set(list)];
}

export const isSiteAdmin = (email: string | null | undefined, env: Env = process.env) =>
  !!email && siteAdmins(env).includes(normalize(email));

const DAY = 86_400_000;
/** How long an approve link in an email works. */
export const APPROVE_LINK_DAYS = 30;

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`waitlist-approve:${payload}`).digest("base64url");
}

/** A link token that approves one email, signed with the auth secret, for APPROVE_LINK_DAYS. */
export function approvalToken(
  email: string,
  now = Date.now(),
  secret = process.env.BETTER_AUTH_SECRET ?? "",
): string {
  const payload = Buffer.from(`${normalize(email)}|${now + APPROVE_LINK_DAYS * DAY}`).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The email an approve token is for, or null when it's forged, altered or expired. */
export function readApprovalToken(
  token: string,
  now = Date.now(),
  secret = process.env.BETTER_AUTH_SECRET ?? "",
): string | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac || !secret) return null;
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [email, exp] = Buffer.from(payload, "base64url").toString("utf8").split("|");
  if (!email || !(Number(exp) > now)) return null;
  return email;
}

export type WaitlistEntry = {
  email: string;
  name: string | null;
  source: "email" | "google";
  status: "waiting" | "approved";
  createdAt: string;
  approvedAt: string | null;
};

export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const { rows } = await sql<{
    email: string;
    name: string | null;
    source: "email" | "google";
    status: "waiting" | "approved";
    created_at: Date;
    approved_at: Date | null;
  }>`select email, name, source, status, created_at, approved_at from waitlist
       order by status = 'approved', created_at desc`.execute(db);
  return rows.map((r) => ({
    email: r.email,
    name: r.name,
    source: r.source,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
  }));
}

export async function findWaitlisted(email: string): Promise<WaitlistEntry | null> {
  return (await listWaitlist()).find((e) => e.email === normalize(email)) ?? null;
}

/**
 * Lets one person in: their row becomes approved and they're emailed a link to create their account. Approving
 * someone already approved changes nothing and sends nothing.
 */
export async function approveWaitlisted(
  email: string,
): Promise<{ ok: true; already: boolean; emailed: boolean } | { ok: false }> {
  const { rows } = await sql<{ name: string | null; was: string }>`
    update waitlist w set status = 'approved', approved_at = coalesce(w.approved_at, now()), updated_at = now()
    from (select status as was from waitlist where email = ${normalize(email)}) old
    where w.email = ${normalize(email)}
    returning w.name, old.was`.execute(db);
  const row = rows[0];
  if (!row) return { ok: false };
  if (row.was === "approved") return { ok: true, already: true, emailed: false };
  const to = normalize(email);
  const emailed = await sendMail(
    waitlistApprovedEmail({ to, name: row.name, url: appUrl(`/sign-up?email=${encodeURIComponent(to)}`) }),
  );
  return { ok: true, already: false, emailed };
}

/** Tells every site admin that someone new joined, with a one-click approve link. Never throws. */
export async function notifyAdminsOfJoin(entry: {
  email: string;
  name: string | null;
  source: "email" | "google";
}) {
  const admins = siteAdmins();
  const waiting = await sql<{ n: number }>`select count(*)::int as n from waitlist where status = 'waiting'`
    .execute(db)
    .then((r) => r.rows[0]?.n ?? 1)
    .catch(() => 1);
  await Promise.all(
    admins.map((to) =>
      sendMail(
        waitlistJoinedEmail({
          to,
          name: entry.name,
          email: normalize(entry.email),
          source: entry.source,
          waiting,
          approveUrl: appUrl(`/waitlist/approve?token=${encodeURIComponent(approvalToken(entry.email))}`),
          listUrl: appUrl("/admin/waitlist"),
        }),
      ).catch(() => false),
    ),
  );
}
