import "server-only";
import { adminNoticeEmail } from "@/server/emails";
import { appUrl, sendMail } from "@/server/mail";
import { siteAdmins } from "@/server/waitlist-admin";

/** Emails every site admin. Never throws: a mail outage must not break the request that caused it. */
export async function notifyAdmins(n: {
  subject: string;
  heading: string;
  lines: string[];
  action: { label: string; path: string };
}) {
  await Promise.all(
    siteAdmins().map((to) =>
      sendMail(
        adminNoticeEmail({ to, ...n, action: { label: n.action.label, url: appUrl(n.action.path) } }),
      ).catch(() => false),
    ),
  );
}
