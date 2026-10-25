/**
 * Throwaway inbox services. Accounts on them are refused at sign-up: each new account gets free AI credits, and an
 * address that disappears in ten minutes is how people collect them again and again. Not exhaustive; add domains
 * as they show up in /admin/accounts.
 */
export const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxbear.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mailpoof.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "mytemp.email",
  "nada.email",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.dev",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

export const DISPOSABLE_CODE = "DISPOSABLE_EMAIL";
export const DISPOSABLE_MESSAGE =
  "Use your own email address. Temporary inboxes can't create an EveryOps account.";

/** Whether an address is on a throwaway inbox service, subdomains included. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++)
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  return false;
}
